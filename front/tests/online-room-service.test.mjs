import { afterEach, describe, expect, test, vi } from "vitest";

import {
  OnlineRoomClient,
  createRoomId,
  normalizeRoomId
} from "../src/services/onlineRoom.js";

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeSocket.CONNECTING;
    this.send = vi.fn();
    this.close = vi.fn((code, reason) => {
      this.readyState = FakeSocket.CLOSING;
      this.closeArgs = [code, reason];
    });
    FakeSocket.instances.push(this);
  }
}

const installSocket = () => {
  FakeSocket.instances = [];
  globalThis.WebSocket = FakeSocket;
};

afterEach(() => {
  vi.useRealTimers();
  delete globalThis.WebSocket;
});

describe("online room service", () => {
  test("generates and normalizes room identifiers through every entropy source", () => {
    expect(createRoomId({ randomUUID: () => "12345678-abcd" })).toBe(
      "12345678"
    );
    expect(
      createRoomId({
        getRandomValues: (bytes) => {
          bytes.set([0, 1, 254, 255]);
          return bytes;
        }
      })
    ).toBe("0001FEFF");
    expect(createRoomId({}, () => 0)).toBe("00000000");
    expect(normalizeRoomId(" ab!_c-d? ")).toBe("AB_C-D");
    expect(normalizeRoomId(null)).toBe("");
  });

  test("sanitizes signaling URLs and rejects unsupported protocols", () => {
    expect(
      new OnlineRoomClient("https://user:pass@example.test/path/").url
    ).toBe("wss://example.test/path");
    expect(new OnlineRoomClient("http://example.test").url).toBe(
      "ws://example.test"
    );
    expect(() => new OnlineRoomClient("ftp://example.test")).toThrow(TypeError);
  });

  test("validates listeners and isolates listener failures", () => {
    const client = new OnlineRoomClient();
    expect(() => client.onMessage(null)).toThrow(TypeError);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = vi.fn(() => {
      throw new Error("listener");
    });
    const good = vi.fn();
    const unsubscribe = client.onMessage(bad);
    client.onMessage(good);
    client.emit({ type: "ok" });
    expect(good).toHaveBeenCalledWith({ type: "ok" });
    expect(error).toHaveBeenCalled();
    unsubscribe();
    client.emit({ type: "again" });
    expect(bad).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  test("connects with a safe participant name and parses valid packets", async () => {
    installSocket();
    const client = new OnlineRoomClient("ws://example.test/");
    const listener = vi.fn();
    client.onMessage(listener);
    const connection = client.connect({
      id: " room-1 ",
      name: " A\u0000B ",
      host: true
    });
    const socket = FakeSocket.instances[0];
    expect(socket.url).toContain("/rooms/ROOM-1?");
    expect(socket.url).toContain("name=A+B");
    expect(socket.url).toContain("role=host");
    socket.readyState = FakeSocket.OPEN;
    socket.onopen();
    await expect(connection).resolves.toBe("ROOM-1");
    socket.onopen();
    expect(() => socket.onerror(new Event("error"))).not.toThrow();
    socket.onmessage({ data: JSON.stringify({ type: "state" }) });
    socket.onmessage({ data: "[1]" });
    socket.onmessage({ data: "bad" });
    socket.onmessage({ data: new ArrayBuffer(1) });
    expect(listener).toHaveBeenCalledTimes(1);
    socket.onclose({ code: 1000 });
  });

  test("uses the guest fallback, sends bounded objects and disconnects", async () => {
    installSocket();
    const client = new OnlineRoomClient();
    const connection = client.connect({ id: "ABCD", name: "\u0001" });
    const socket = FakeSocket.instances[0];
    expect(socket.url).toContain("role=guest");
    socket.readyState = FakeSocket.OPEN;
    socket.onopen();
    await connection;
    expect(client.send(" update ", { value: 1 })).toBe(true);
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({
      value: 1,
      type: "update"
    });
    expect(client.send("", {})).toBe(false);
    expect(client.send("x", [])).toBe(false);
    expect(client.send("x", { value: "x".repeat(300_000) })).toBe(false);
    expect(client.send("x", { value: 1n })).toBe(false);
    client.disconnect();
    expect(socket.close).toHaveBeenCalledWith(1000, "Client left room");
    expect(client.send("x")).toBe(false);
  });

  test("rejects invalid setup and synchronous WebSocket construction errors", async () => {
    const client = new OnlineRoomClient();
    await expect(client.connect({ id: "a" })).rejects.toThrow(Error);
    await expect(client.connect({ id: "ABCD" })).rejects.toThrow(/WebSocket/);
    globalThis.WebSocket = class {
      constructor() {
        throw new Error("constructor failed");
      }
    };
    await expect(client.connect({ id: "ABCD" })).rejects.toThrow(
      "constructor failed"
    );
    globalThis.WebSocket = class {
      static CLOSING = 2;
      constructor() {
        throw "socket failure"; // eslint-disable-line no-throw-literal
      }
    };
    await expect(client.connect({ id: "ABCD" })).rejects.toThrow(Error);
  });

  test("reports close details, emits closure and ignores stale sockets", async () => {
    installSocket();
    const client = new OnlineRoomClient();
    const listener = vi.fn();
    client.onMessage(listener);
    const firstConnection = client.connect({ id: "ABCD" });
    const first = FakeSocket.instances[0];
    const secondConnection = client.connect({ id: "EFGH" });
    const second = FakeSocket.instances[1];
    first.onopen();
    expect(first.close).toHaveBeenLastCalledWith(1000, "Stale connection");
    first.onclose({ code: 1000 });
    await expect(firstConnection).rejects.toThrow();
    second.onclose({ code: 4001, reason: " denied " });
    await expect(secondConnection).rejects.toThrow(/denied/);
    expect(listener).toHaveBeenCalledWith({ type: "connection-closed" });
  });

  test("closes oversized packets and times out unresponsive servers", async () => {
    vi.useFakeTimers();
    installSocket();
    const client = new OnlineRoomClient();
    const connection = client.connect({ id: "ABCD" });
    const socket = FakeSocket.instances[0];
    socket.onmessage({ data: "x".repeat(300_000) });
    expect(socket.close).toHaveBeenCalledWith(1009, "Message too large");
    const rejection = expect(connection).rejects.toThrow(Error);
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
    expect(socket.close).toHaveBeenCalled();
  });

  test("ignores an obsolete connection timeout", async () => {
    vi.useFakeTimers();
    installSocket();
    const client = new OnlineRoomClient();
    const firstConnection = client.connect({ id: "ABCD" });
    const first = FakeSocket.instances[0];
    const secondConnection = client.connect({ id: "EFGH" });
    const second = FakeSocket.instances[1];
    const secondRejection = expect(secondConnection).rejects.toThrow(Error);
    await vi.advanceTimersByTimeAsync(10_000);
    await secondRejection;
    expect(second.close).toHaveBeenCalled();
    const firstRejection = expect(firstConnection).rejects.toThrow(Error);
    first.onclose({ code: 1000 });
    await firstRejection;
  });
});
