import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { afterEach, expect, test, vi } from "vitest";
import { lightingColor, readLightingMusic, registerLightingSource, observeLightingMedia } from "../src/services/keyboardLighting";
const require = createRequire(import.meta.url);
const { LightingController, installLightingShutdown } = require("../electron/rgb/controller.cjs");
const { parseController, uint32, packet } = require("../electron/rgb/protocol.cjs");
const { OpenRgb, supportsRealtime } = require("../electron/rgb/openrgb.cjs");
const controllers = [];
test("application exit waits for hardware restoration, repeated quit does not duplicate it", async () => {
  const app = new EventEmitter();
  app.quit = vi.fn();
  let resolve;
  const lighting = {
    close: vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    )
  };
  installLightingShutdown(app, lighting);
  const event = { preventDefault: vi.fn() };
  app.emit("before-quit", event);
  app.emit("before-quit", event);
  await vi.waitFor(() => expect(lighting.close).toHaveBeenCalledTimes(1));
  expect(app.quit).not.toHaveBeenCalled();
  resolve();
  await vi.waitFor(() => expect(app.quit).toHaveBeenCalledTimes(1));
  event.preventDefault.mockClear();
  app.emit("before-quit", event);
  expect(event.preventDefault).not.toHaveBeenCalled();
});

test("failed hardware restoration does not trap application exit", async () => {
  const app = new EventEmitter();
  app.quit = vi.fn();
  installLightingShutdown(app, {
    close: async () => {
      throw Error("unplugged");
    }
  });
  app.emit("before-quit", { preventDefault() {} });
  await vi.waitFor(() => expect(app.quit).toHaveBeenCalledTimes(1));
});
test("real-time support depends on capabilities, not brand; automatic-save modes are excluded", () => {
  const keyboard = { type: 5, colorCount: 100, name: "Any brand", modes: [{ name: "Direct", flags: 32 }] };
  expect(supportsRealtime(keyboard)).toBe(true);
  expect(supportsRealtime({ ...keyboard, type: 2 })).toBe(false);
  expect(supportsRealtime({ ...keyboard, modes: [{ name: "Static", flags: 32 }] })).toBe(false);
  expect(supportsRealtime({ ...keyboard, modes: [{ name: "Direct", flags: 512 }] })).toBe(false);
});
test("a detected keyboard without real-time mode has an explicit unsupported status", async () => {
  const client = { ...openrgb(), state: "unsupported", start: async () => [] };
  const c = controller({ openrgb: () => client });
  expect(await c.configure(true)).toMatchObject({ state: "unsupported", count: 0 });
});
afterEach(async () => {
  for (const c of controllers.splice(0)) await c.close();
  vi.restoreAllMocks();
});
function controller(options) {
  const c = new LightingController(options);
  controllers.push(c);
  return c;
}
const frame = { active: true, rgb: [12, 25, 255] };
function openrgb() {
  return { state: "ready", start: vi.fn(async () => ["Keyboard"]), stop: vi.fn(), frame: vi.fn(), release: vi.fn() };
}

test("lighting disabled by default; validates frames and limits update rate", async () => {
  let clock = 10000;
  const client = openrgb();
  const c = controller({ openrgb: () => client, now: () => clock });
  await c.frame(frame);
  expect(client.start).not.toHaveBeenCalled();
  await c.configure(true);
  await c.frame({ ...frame, rgb: [999, 0, 0] });
  expect(client.frame).not.toHaveBeenCalled();
  await c.frame(frame);
  await c.frame(frame);
  expect(client.frame).toHaveBeenCalledTimes(1);
  clock += 50;
  await c.frame({ ...frame, active: false });
  expect(client.release).toHaveBeenCalled();
  await c.configure(false);
  clock += 50;
  await c.frame(frame);
  expect(client.frame).toHaveBeenCalledTimes(1);
});
test("prefers available Windows keyboards and does not open OpenRGB too", async () => {
  const windows = { request: vi.fn(async () => ({ state: "ready", count: 1 })) };
  const fallback = vi.fn();
  const c = controller({ windows, openrgb: fallback });
  expect(await c.configure(true)).toMatchObject({ provider: "windows", count: 1 });
  await c.frame(frame);
  expect(windows.request).toHaveBeenCalledWith(1, 12, 25, 255);
  expect(fallback).not.toHaveBeenCalled();
  await c.configure(false);
  expect(windows.request).toHaveBeenCalledWith(2);
});
test("missing OpenRGB does not hide native no-devices diagnostics", async () => {
  const c = controller({
    windows: { request: async () => ({ state: "no_devices", count: 0 }) },
    openrgb: () => ({
      start: async () => {
        throw Error("offline");
      },
      stop() {}
    })
  });
  expect(await c.configure(true)).toEqual({ state: "no_devices", count: 0 });
});

test("embedded USB needs no OpenRGB and restores lighting on pause and disable", async () => {
  let clock = 10000;
  const windows = {
    request: vi.fn(async () => ({ state: "no_devices", count: 0 })),
    usbRequest: vi.fn(async () => ({ state: "ready", count: 2 }))
  };
  const fallback = vi.fn();
  const c = controller({ windows, openrgb: fallback, now: () => clock });
  expect(await c.configure(true)).toMatchObject({ provider: "usb", count: 2 });
  expect(fallback).not.toHaveBeenCalled();
  await c.frame(frame);
  expect(windows.usbRequest).toHaveBeenCalledWith(1, ...frame.rgb);
  clock += 50;
  await c.frame({ ...frame, active: false });
  expect(windows.usbRequest).toHaveBeenLastCalledWith(2);
  clock += 50;
  await c.frame(frame);
  expect(windows.usbRequest).toHaveBeenLastCalledWith(1, ...frame.rgb);
  await c.configure(false);
  expect(windows.usbRequest).toHaveBeenLastCalledWith(2);
});

test("disabling during USB discovery releases handles and never publishes ready", async () => {
  let resolve;
  const usb = {
    request: vi.fn((action) =>
      action === 0
        ? new Promise((r) => {
            resolve = r;
          })
        : Promise.resolve({ count: 0 })
    )
  };
  const fallback = vi.fn();
  const c = controller({ usb, openrgb: fallback });
  const on = c.configure(true);
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  const off = c.configure(false);
  resolve({ state: "ready", count: 1 });
  await Promise.all([on, off]);
  expect(c.status.state).toBe("disabled");
  expect(usb.request).toHaveBeenLastCalledWith(2);
  expect(fallback).not.toHaveBeenCalled();
});

test("USB disconnect releases and rediscovers without piling up frames", async () => {
  let clock = 10000,
    resolve;
  const usb = {
    request: vi.fn((action) =>
      action === 1
        ? new Promise((r) => {
            resolve = r;
          })
        : Promise.resolve({ state: "ready", count: 1 })
    )
  };
  const c = controller({ usb, now: () => clock });
  await c.configure(true);
  const pending = c.frame(frame);
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  clock += 100;
  await c.frame(frame);
  expect(usb.request.mock.calls.filter(([action]) => action === 1)).toHaveLength(1);
  resolve({ state: "no_devices", count: 0 });
  await pending;
  expect(c.provider).toBeNull();
  usb.request.mockImplementation(async () => ({ state: "ready", count: 1 }));
  clock += 6000;
  await c.frame(frame);
  expect(c.status).toMatchObject({ provider: "usb", count: 1 });
});
test("turning off during discovery never reactivates a stale provider", async () => {
  let resolve;
  const client = openrgb();
  client.start = () =>
    new Promise((r) => {
      resolve = r;
    });
  const c = controller({ openrgb: () => client });
  const on = c.configure(true);
  await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
  const off = c.configure(false);
  resolve(["Keyboard"]);
  await Promise.all([on, off]);
  expect(c.status.state).toBe("disabled");
  expect(c.provider).toBeNull();
  expect(client.stop).toHaveBeenCalled();
});
test("music selection prioritizes active karaoke and unregisters without losing replacements", () => {
  const radio = registerLightingSource("radio", () => ({ active: true, level: 0.3 }));
  const karaoke = registerLightingSource("karaoke", () => ({ active: true, level: 0.8 }));
  expect(readLightingMusic().level).toBe(0.8);
  karaoke();
  expect(readLightingMusic().level).toBe(0.3);
  radio();
  expect(readLightingMusic()).toEqual({ active: false, level: 0 });
  expect(lightingColor("#ff0000", 0.5, 0.5, "music")).toEqual([64, 0, 0]);
  expect(lightingColor("#ff0000", 0, 1, "theme")).toEqual([0, 0, 0]);
  expect(lightingColor("#00ff00", 1, 0, "theme")).toEqual([0, 255, 0]);
});
test("unsupported media analysis does not modify the playback element", () => {
  const media = { pause: vi.fn(), play: vi.fn() };
  observeLightingMedia(media)();
  expect(media.pause).not.toHaveBeenCalled();
  expect(media.play).not.toHaveBeenCalled();
});
const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const str = (s) => Buffer.concat([u16(Buffer.byteLength(s) + 1), Buffer.from(`${s}\0`)]);
function fixture(type = 5, name = "Keyboard") {
  const mode = Buffer.concat([str("Direct"), uint32(0), uint32(32), Buffer.alloc(28), u16(0)]);
  const body = Buffer.concat([
    uint32(type),
    str(name),
    ...Array(5).fill(str("")),
    u16(1),
    uint32(0),
    mode,
    u16(0),
    u16(1),
    str("LED"),
    uint32(0),
    u16(1),
    Buffer.from([1, 2, 3, 0])
  ]);
  return Buffer.concat([uint32(body.length + 4), body]);
}
test("protocol parses v1, rejects truncated / oversized color data", () => {
  expect(parseController(fixture(), 7)).toMatchObject({ id: 7, type: 5, colorCount: 1, activeMode: 0 });
  expect(() => parseController(fixture().subarray(0, 12), 0)).toThrow();
});
test("SDK fragmented replies, keyboard-only writes, original colors/mode restored", async () => {
  const writes = [];
  class Socket extends EventEmitter {
    destroyed = false;
    writableLength = 0;
    setNoDelay() {}
    write(data) {
      writes.push(data);
      const id = data.readUInt32LE(8),
        device = data.readUInt32LE(4);
      const reply = id === 40 ? uint32(1) : id === 0 ? uint32(2) : id === 1 ? fixture(device === 0 ? 2 : 5) : null;
      if (reply)
        queueMicrotask(() => {
          const p = packet(id, device, reply);
          this.emit("data", p.subarray(0, 7));
          this.emit("data", p.subarray(7));
        });
      return true;
    }
    end() {
      this.destroy();
    }
    destroy() {
      if (!this.destroyed) {
        this.destroyed = true;
        this.emit("close");
      }
    }
  }
  const socket = new Socket();
  const client = new OpenRgb((options) => {
    expect(options).toEqual({ host: "127.0.0.1", port: 6742 });
    queueMicrotask(() => socket.emit("connect"));
    return socket;
  });
  expect(await client.start()).toEqual(["Keyboard"]);
  client.frame([11, 22, 33]);
  client.release();
  client.stop();
  const mutations = writes.filter((b) => b.readUInt32LE(8) >= 1000);
  expect(mutations.every((b) => b.readUInt32LE(4) === 1)).toBe(true);
  expect(mutations.map((b) => b.readUInt32LE(8))).toEqual([1100, 1050, 1050, 1101]);
  expect([...mutations[1].subarray(-4)]).toEqual([11, 22, 33, 0]);
  expect([...mutations[2].subarray(-4)]).toEqual([1, 2, 3, 0]);
});
