import { afterEach, describe, expect, test, vi } from "vitest";
import { translateSaved } from "../src/i18n/runtime.js";
import {
  DEFAULT_SIGNALING_URL,
  OnlineRoomClient,
  createRoomId,
  getOrCreateGuestSessionId,
  normalizeRoomId
} from "../src/services/onlineRoom.js";
import { same, verify } from "./helpers/assertions.mjs";
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
const loadOnlineRoomService = async () => {
  vi.resetModules();
  return import("../src/services/onlineRoom.js");
};
afterEach(() => {
  vi.useRealTimers();
  delete globalThis.WebSocket;
});
describe("online room service", () => {
  test("loads deployment limits from the active module instance", async () => {
    const service = await loadOnlineRoomService();
    verify([service.DEFAULT_SIGNALING_URL, "toBe", "wss://karaoke-studio-online.pro100dimka-and.workers.dev"]);
    installSocket();
    const client = new service.OnlineRoomClient();
    const connection = client.connect({ id: "ABCD" });
    const socket = FakeSocket.instances[0];
    expect(new URL(socket.url).searchParams.get("name")).toBe(translateSaved("Гость"));
    expect(new URL(socket.url).searchParams.get("v")).toBe(String(service.ROOM_PROTOCOL_VERSION));
    socket.readyState = FakeSocket.OPEN;
    socket.onopen();
    await connection;
    expect(client.send("message", { text: "x".repeat(1024) })).toBe(true);
    client.disconnect();
  });
  test("generates and normalizes room identifiers through every entropy source", () => {
    same(
      [DEFAULT_SIGNALING_URL, "wss://karaoke-studio-online.pro100dimka-and.workers.dev"],
      [createRoomId({ randomUUID: () => "ab-cd-ef-gh-12-34-56" }), "ABCDEFGH1234"]
    );
    verify([
      createRoomId({
        getRandomValues: (bytes) => {
          bytes.set([0, 1, 254, 255, 16, 32]);
          return bytes;
        }
      }),
      "toBe",
      "0001FEFF1020"
    ]);
    verify([createRoomId({}, () => 0), "toBe", "000000000000"], [createRoomId(null, () => 0xabcdef12 / 0x1_0000_0000), "toHaveLength", 12]);
    same(
      [normalizeRoomId(" ab!_c-d? "), "AB_C-D"],
      [normalizeRoomId(`a${"b".repeat(40)}`), `A${"B".repeat(31)}`],
      [normalizeRoomId(null), ""]
    );
  });
  test("sanitizes signaling URLs and rejects unsupported protocols", () => {
    verify([new OnlineRoomClient("https://user:pass@example.test/path/").url, "toBe", "wss://example.test/path"]);
    expect(new OnlineRoomClient("http://example.test").url).toBe("ws://example.test");
    verify([() => new OnlineRoomClient("ftp://example.test"), "toThrow", translateSaved("Некорректный адрес сервера комнат")]);
  });
  test("validates listeners and isolates listener failures", () => {
    const client = new OnlineRoomClient();
    verify([() => client.onMessage(null), "toThrow", translateSaved("Обработчик сообщений комнаты должен быть функцией")]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = vi.fn(() => {
      throw new Error("listener");
    });
    const good = vi.fn();
    const unsubscribe = client.onMessage(bad);
    client.onMessage(good);
    client.emit({ type: "ok" });
    expect(good).toHaveBeenCalledWith({ type: "ok" });
    verify([error, "toHaveBeenCalledWith", "Online room listener failed", expect.objectContaining({ message: "listener" })]);
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
    const connection = client.connect({ id: " room-1 ", name: " A\u001fB\u007fC ", host: true });
    const socket = FakeSocket.instances[0];
    verify(
      [socket.url, "toContain", "/rooms/ROOM-1?"],
      [new URL(socket.url).searchParams.get("name"), "toBe", "A B C"],
      [socket.url, "toContain", "role=host"]
    );
    socket.readyState = FakeSocket.OPEN;
    socket.onopen();
    await expect(connection).resolves.toBe("ROOM-1");
    socket.onopen();
    expect(() => socket.onerror(new Event("error"))).not.toThrow();
    socket.onmessage({ data: JSON.stringify({ type: "state" }) });
    socket.onmessage({ data: "null" });
    socket.onmessage({ data: "1" });
    socket.onmessage({ data: JSON.stringify("text") });
    socket.onmessage({ data: "[1]" });
    socket.onmessage({ data: "bad" });
    socket.onmessage({ data: new ArrayBuffer(1) });
    socket.onmessage({ data: { length: 16, toString: () => JSON.stringify({ type: "coerced" }) } });
    verify([listener, "toHaveBeenCalledTimes", 1], [listener, "toHaveBeenCalledWith", { type: "state" }]);
    socket.onclose({ code: 1000 });
    expect(client.socket).toBeNull();
  });
  test("estimates server time from a midpoint clock probe", async () => {
    installSocket();
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const client = new OnlineRoomClient("ws://example.test/");
    const connection = client.connect({ id: "ABCD" });
    const socket = FakeSocket.instances[0];
    socket.readyState = FakeSocket.OPEN;
    socket.onopen();
    await connection;
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({
      type: "ping",
      clientTime: 1_000
    });

    now.mockReturnValue(1_100);
    socket.onmessage({
      data: JSON.stringify({ type: "pong", clientTime: 1_000, serverTime: 1_075 })
    });
    expect(client.serverNow()).toBe(1_125);
    now.mockRestore();
    client.disconnect();
  });
  test("keeps the lowest round-trip clock sample instead of adding WebSocket queue delay", async () => {
    installSocket();
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const client = new OnlineRoomClient("ws://example.test/");
    const connection = client.connect({ id: "ABCD" });
    const socket = FakeSocket.instances[0];
    socket.readyState = FakeSocket.OPEN;
    socket.onopen();
    await connection;

    now.mockReturnValue(1_100);
    socket.onmessage({
      data: JSON.stringify({ type: "pong", clientTime: 1_000, serverTime: 1_075 })
    });
    expect(client.clockOffsetMs).toBe(25);

    // This sample spent much longer queued and must not pull the shared
    // playback clock away from the cleaner first measurement.
    now.mockReturnValue(1_400);
    socket.onmessage({
      data: JSON.stringify({ type: "pong", clientTime: 1_200, serverTime: 1_280 })
    });
    expect(client.clockOffsetMs).toBe(25);

    now.mockRestore();
    client.disconnect();
  });
  test("getOrCreateGuestSessionId persists across calls but tolerates a missing storage", () => {
    const store = new Map();
    const fakeStorage = {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value)
    };
    const first = getOrCreateGuestSessionId(fakeStorage, { randomUUID: () => "generated-id" });
    expect(first).toBe("generated-id");
    // A second call reuses the persisted value instead of generating a new
    // one -- this is what lets a reconnect within the same session claim
    // back the same room participant id.
    const second = getOrCreateGuestSessionId(fakeStorage, { randomUUID: () => "different-id" });
    expect(second).toBe("generated-id");

    // No storage available (privacy mode, restricted context) must not
    // throw -- reconnect identity is a nice-to-have, not required.
    expect(getOrCreateGuestSessionId(undefined, { randomUUID: () => "no-storage-id" })).toBe(
      "no-storage-id"
    );
  });
  test("only a guest connection carries a reconnect session id, never the host", async () => {
    installSocket();
    const client = new OnlineRoomClient();
    const guestConnection = client.connect({ id: "ABCD" });
    const guestSocket = FakeSocket.instances[0];
    expect(new URL(guestSocket.url).searchParams.get("sessionId")).toBeTruthy();
    guestSocket.readyState = FakeSocket.OPEN;
    guestSocket.onopen();
    await guestConnection;

    const hostConnection = client.connect({ id: "EFGH", host: true, hostToken: "x".repeat(32) });
    const hostSocket = FakeSocket.instances.at(-1);
    expect(new URL(hostSocket.url).searchParams.has("sessionId")).toBe(false);
    hostSocket.readyState = FakeSocket.OPEN;
    hostSocket.onopen();
    await hostConnection;
  });
  test("uses the guest fallback, sends bounded objects and disconnects", async () => {
    installSocket();
    const client = new OnlineRoomClient();
    const connection = client.connect({ id: "ABCD", name: "\u0001" });
    const socket = FakeSocket.instances[0];
    expect(socket.url).toContain("role=guest");
    same([new URL(socket.url).searchParams.get("name"), translateSaved("Гость")], [client.send("x", {}), false]);
    expect(socket.send).not.toHaveBeenCalled();
    socket.readyState = FakeSocket.OPEN;
    socket.onopen();
    await connection;
    expect(client.send(" update ", { value: 1 })).toBe(true);
    expect(socket.send.mock.calls.map(([message]) => JSON.parse(message))).toContainEqual({
      value: 1,
      type: "update"
    });
    same(
      [client.send("", {}), false],
      [client.send("   ", {}), false],
      [client.send(null, {}), false],
      [client.send("x", []), false],
      [client.send("x", null), false],
      [client.send("x", "payload"), false]
    );
    const serializedOverhead = JSON.stringify({ value: "", type: "x" }).length;
    expect(client.send("x", { value: "x".repeat(256 * 1024 - serializedOverhead) })).toBe(true);
    verify([client.send("x", { value: "x".repeat(256 * 1024 - serializedOverhead + 1) }), "toBe", false]);
    same([client.send("x", { value: "x".repeat(300_000) }), false], [client.send("x", { value: 1n }), false]);
    client.disconnect();
    verify([socket.close, "toHaveBeenCalledWith", 1000, "Client left room"], [client.send("x"), "toBe", false]);
    const longConnection = client.connect({
      id: "ABCD",
      name: `A${"b".repeat(80)}`
    });
    const longSocket = FakeSocket.instances.at(-1);
    expect(new URL(longSocket.url).searchParams.get("name")).toBe(`A${"b".repeat(39)}`);
    longSocket.readyState = FakeSocket.OPEN;
    longSocket.onopen();
    await longConnection;
    client.disconnect();
  });
  test("applies signaling limits to UTF-8 bytes instead of UTF-16 characters", async () => {
    installSocket();
    const client = new OnlineRoomClient();
    const connection = client.connect({ id: "ABCD" });
    const socket = FakeSocket.instances[0];
    socket.readyState = FakeSocket.OPEN;
    socket.onopen();
    await connection;
    expect(client.send("x", { value: "я".repeat(130_000) })).toBe(true);
    expect(client.send("x", { value: "я".repeat(132_000) })).toBe(false);
    expect(client.send("signal", { signal: "я".repeat(33_000) })).toBe(false);
    socket.onmessage({ data: "я".repeat(132_000) });
    expect(socket.close).toHaveBeenCalledWith(1009, "Message too large");
  });
  test("rejects invalid setup and synchronous WebSocket construction errors", async () => {
    const client = new OnlineRoomClient();
    await expect(client.connect({ id: "a" })).rejects.toThrow(translateSaved("Код комнаты должен содержать минимум 4 символа."));
    await expect(client.connect({ id: "ABCD" })).rejects.toThrow(translateSaved("WebSocket не поддерживается в этом окружении."));
    globalThis.WebSocket = class {
      constructor() {
        throw new Error("constructor failed");
      }
    };
    await expect(client.connect({ id: "ABCD" })).rejects.toThrow("constructor failed");
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
    first.onmessage({ data: JSON.stringify({ type: "stale" }) });
    expect(listener).not.toHaveBeenCalled();
    first.onopen();
    expect(first.close).toHaveBeenLastCalledWith(1000, "Stale connection");
    first.onclose({ code: 1000 });
    verify([client.socket, "toBe", second], [listener, "not.toHaveBeenCalled"]);
    await expect(firstConnection).rejects.toThrow();
    second.onclose({ code: 4001, reason: " denied " });
    await expect(secondConnection).rejects.toThrow(/denied/);
    expect(listener).toHaveBeenCalledWith({ type: "connection-closed" });
  });
  test("formats every initial close reason exactly", async () => {
    installSocket();
    const expectedError = (detail) =>
      translateSaved("Не удалось подключиться к серверу комнат{0}. Проверьте интернет, VPN, прокси или брандмауэр.", {
        0: detail
      });
    for (const [event, detail] of [
      [{ code: 4001, reason: " denied " }, ": denied"],
      [{ code: 4001, reason: " " }, translateSaved("(код {0})", { 0: 4001 })],
      [{ code: 1006 }, ""],
      [undefined, ""]
    ]) {
      const client = new OnlineRoomClient();
      const connection = client.connect({ id: "ABCD" });
      FakeSocket.instances.at(-1).onclose(event);
      await expect(connection).rejects.toThrow(expectedError(detail));
    }
  });
  test("logs the WebSocket close code and reason for diagnostics", async () => {
    installSocket();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = new OnlineRoomClient();
    const connection = client.connect({ id: "ABCD" });
    FakeSocket.instances.at(-1).onclose({ code: 4001, reason: "denied", wasClean: false });
    await expect(connection).rejects.toThrow();
    expect(error).toHaveBeenCalledWith(
      "Room WebSocket closed",
      expect.objectContaining({ code: 4001, reason: "denied", wasClean: false })
    );
  });
  test("disconnect does not close sockets already closing or closed", async () => {
    installSocket();
    for (const readyState of [FakeSocket.CLOSING, 3]) {
      const client = new OnlineRoomClient();
      const connection = client.connect({ id: "ABCD" });
      const socket = FakeSocket.instances.at(-1);
      socket.readyState = readyState;
      client.disconnect();
      expect(socket.close).not.toHaveBeenCalled();
      socket.onclose({ code: 1000 });
      await expect(connection).rejects.toThrow(Error);
    }
  });
  test("closes oversized packets and times out unresponsive servers", async () => {
    vi.useFakeTimers();
    installSocket();
    const client = new OnlineRoomClient();
    const connection = client.connect({ id: "ABCD" });
    const socket = FakeSocket.instances[0];
    socket.onmessage({ data: "x".repeat(256 * 1024) });
    expect(socket.close).not.toHaveBeenCalled();
    socket.onmessage({ data: "x".repeat(256 * 1024 + 1) });
    expect(socket.close).toHaveBeenCalledWith(1009, "Message too large");
    const rejection = expect(connection).rejects.toThrow(translateSaved("Сервер комнат не ответил."));
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
    expect(socket.close).toHaveBeenCalledTimes(1);
  });
  test("ignores an obsolete connection timeout", async () => {
    vi.useFakeTimers();
    installSocket();
    const client = new OnlineRoomClient();
    const firstConnection = client.connect({ id: "ABCD" });
    let firstError;
    const firstHandled = firstConnection.catch((error) => {
      firstError = error;
    });
    const first = FakeSocket.instances[0];
    const secondConnection = client.connect({ id: "EFGH" });
    let secondError;
    const secondHandled = secondConnection.catch((error) => {
      secondError = error;
    });
    const second = FakeSocket.instances[1];
    await vi.advanceTimersByTimeAsync(10_000);
    const timeoutState = { firstError, secondError };
    first.onclose({ code: 1000 });
    second.onclose({ code: 1000 });
    await Promise.all([firstHandled, secondHandled]);
    expect(timeoutState.firstError).toBeUndefined();
    expect(timeoutState.secondError).toBeInstanceOf(Error);
    expect(second.close).toHaveBeenCalled();
  });
});
