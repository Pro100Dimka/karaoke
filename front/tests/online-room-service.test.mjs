import { afterEach, describe, expect, test, vi } from "vitest";

import { translateSaved } from "../src/i18n/runtime.js";
import {
  DEFAULT_SIGNALING_URL,
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
let serviceImportId = 0;
const loadOnlineRoomService = () =>
  import(/* @vite-ignore */ `../src/services/onlineRoom.js?contract=${serviceImportId++}`);

afterEach(() => {
  vi.useRealTimers();
  delete globalThis.WebSocket;
});

describe("online room service", () => {
  test("loads deployment limits from the active module instance", async () => {
    const service = await loadOnlineRoomService();
    expect(service.DEFAULT_SIGNALING_URL).toBe(
      "wss://karaoke-studio-online.pro100dimka-and.workers.dev"
    );
    installSocket();
    const client = new service.OnlineRoomClient();
    const connection = client.connect({ id: "ABCD" });
    const socket = FakeSocket.instances[0];
    expect(new URL(socket.url).searchParams.get("name")).toBe(translateSaved("Гость"));
    socket.readyState = FakeSocket.OPEN;
    socket.onopen();
    await connection;
    expect(client.send("message", { text: "x".repeat(1024) })).toBe(true);
    client.disconnect();
  });

  test("generates and normalizes room identifiers through every entropy source", () => {
    expect(DEFAULT_SIGNALING_URL).toBe("wss://karaoke-studio-online.pro100dimka-and.workers.dev");
    expect(createRoomId({ randomUUID: () => "ab-cd-ef-gh-12-34-56" })).toBe("ABCDEFGH1234");
    expect(
      createRoomId({
        getRandomValues: (bytes) => {
          bytes.set([0, 1, 254, 255, 16, 32]);
          return bytes;
        }
      })
    ).toBe("0001FEFF1020");
    expect(createRoomId({}, () => 0)).toBe("000000000000");
    expect(createRoomId(null, () => 0xabcdef12 / 0x1_0000_0000)).toHaveLength(12);
    expect(normalizeRoomId(" ab!_c-d? ")).toBe("AB_C-D");
    expect(normalizeRoomId(`a${"b".repeat(40)}`)).toBe(`A${"B".repeat(31)}`);
    expect(normalizeRoomId(null)).toBe("");
  });

  test("sanitizes signaling URLs and rejects unsupported protocols", () => {
    expect(new OnlineRoomClient("https://user:pass@example.test/path/").url).toBe(
      "wss://example.test/path"
    );
    expect(new OnlineRoomClient("http://example.test").url).toBe("ws://example.test");
    expect(() => new OnlineRoomClient("ftp://example.test")).toThrow(
      translateSaved("Некорректный адрес сервера комнат")
    );
  });

  test("validates listeners and isolates listener failures", () => {
    const client = new OnlineRoomClient();
    expect(() => client.onMessage(null)).toThrow(
      translateSaved("Обработчик сообщений комнаты должен быть функцией")
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = vi.fn(() => {
      throw new Error("listener");
    });
    const good = vi.fn();
    const unsubscribe = client.onMessage(bad);
    client.onMessage(good);
    client.emit({ type: "ok" });
    expect(good).toHaveBeenCalledWith({ type: "ok" });
    expect(error).toHaveBeenCalledWith(
      "Online room listener failed",
      expect.objectContaining({ message: "listener" })
    );
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
    expect(socket.url).toContain("/rooms/ROOM-1?");
    expect(new URL(socket.url).searchParams.get("name")).toBe("A B C");
    expect(socket.url).toContain("role=host");
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
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ type: "state" });
    socket.onclose({ code: 1000 });
    expect(client.socket).toBeNull();
  });

  test("uses the guest fallback, sends bounded objects and disconnects", async () => {
    installSocket();
    const client = new OnlineRoomClient();
    const connection = client.connect({ id: "ABCD", name: "\u0001" });
    const socket = FakeSocket.instances[0];
    expect(socket.url).toContain("role=guest");
    expect(new URL(socket.url).searchParams.get("name")).toBe(translateSaved("Гость"));
    expect(client.send("x", {})).toBe(false);
    expect(socket.send).not.toHaveBeenCalled();
    socket.readyState = FakeSocket.OPEN;
    socket.onopen();
    await connection;
    expect(client.send(" update ", { value: 1 })).toBe(true);
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({ value: 1, type: "update" });
    expect(client.send("", {})).toBe(false);
    expect(client.send("   ", {})).toBe(false);
    expect(client.send(null, {})).toBe(false);
    expect(client.send("x", [])).toBe(false);
    expect(client.send("x", null)).toBe(false);
    expect(client.send("x", "payload")).toBe(false);
    const serializedOverhead = JSON.stringify({ value: "", type: "x" }).length;
    expect(client.send("x", { value: "x".repeat(256 * 1024 - serializedOverhead) })).toBe(true);
    expect(client.send("x", { value: "x".repeat(256 * 1024 - serializedOverhead + 1) })).toBe(
      false
    );
    expect(client.send("x", { value: "x".repeat(300_000) })).toBe(false);
    expect(client.send("x", { value: 1n })).toBe(false);
    client.disconnect();
    expect(socket.close).toHaveBeenCalledWith(1000, "Client left room");
    expect(client.send("x")).toBe(false);

    const longConnection = client.connect({
      id: "ABCD",
      name: `A${"b".repeat(80)}`
    });
    const longSocket = FakeSocket.instances.at(-1);
    expect(new URL(longSocket.url).searchParams.get("name")).toBe(`A${"b".repeat(63)}`);
    longSocket.readyState = FakeSocket.OPEN;
    longSocket.onopen();
    await longConnection;
    client.disconnect();
  });

  test("rejects invalid setup and synchronous WebSocket construction errors", async () => {
    const client = new OnlineRoomClient();
    await expect(client.connect({ id: "a" })).rejects.toThrow(
      translateSaved("Код комнаты должен содержать минимум 4 символа.")
    );
    await expect(client.connect({ id: "ABCD" })).rejects.toThrow(
      translateSaved("WebSocket не поддерживается в этом окружении.")
    );
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
    expect(client.socket).toBe(second);
    expect(listener).not.toHaveBeenCalled();
    await expect(firstConnection).rejects.toThrow();
    second.onclose({ code: 4001, reason: " denied " });
    await expect(secondConnection).rejects.toThrow(/denied/);
    expect(listener).toHaveBeenCalledWith({ type: "connection-closed" });
  });

  test("formats every initial close reason exactly", async () => {
    installSocket();
    const expectedError = (detail) =>
      translateSaved(
        "Не удалось подключиться к серверу комнат{0}. Проверьте интернет, VPN, прокси или брандмауэр.",
        { 0: detail }
      );
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
    const rejection = expect(connection).rejects.toThrow(
      translateSaved("Сервер комнат не ответил.")
    );
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
