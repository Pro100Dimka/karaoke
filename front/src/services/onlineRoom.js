const DEFAULT_SIGNALING_URL =
  "wss://karaoke-studio-online.pro100dimka-and.workers.dev";

const CONNECTION_TIMEOUT_MS = 10_000;


export function createRoomId(
  cryptoApi = globalThis.crypto,
  random = Math.random
) {
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  }

  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(4));
    return [...bytes]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }

  return Math.floor(random() * 0x1_0000_0000)
    .toString(16)
    .padStart(8, "0")
    .slice(-8)
    .toUpperCase();
}

export function normalizeRoomId(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 32);
}

export class OnlineRoomClient {
  constructor(url = DEFAULT_SIGNALING_URL) {
    this.url = url.replace(/^http/, "ws").replace(/\/$/, "");
    this.listeners = new Set();
    this.socket = null;
    this.connectionVersion = 0;
  }

  onMessage(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(message) {
    this.listeners.forEach((listener) => listener(message));
  }

  connect({ id, name, host = false }) {
    const normalizedId = normalizeRoomId(id);
    if (normalizedId.length < 4) {
      return Promise.reject(
        new Error("Код комнаты должен содержать минимум 4 символа.")
      );
    }

    this.disconnect();
    const connectionVersion = this.connectionVersion;
    const query = new URLSearchParams({
      name: name?.trim() || "Гость",
      role: host ? "host" : "guest"
    });
    const socket = new WebSocket(`${this.url}/rooms/${normalizedId}?${query}`);
    this.socket = socket;

    return new Promise((resolve, reject) => {
      let settled = false;
      const isCurrent = () =>
        this.socket === socket && this.connectionVersion === connectionVersion;
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        callback(value);
      };
      const fail = (message) => {
        if (!isCurrent()) return;
        if (this.socket === socket) this.socket = null;
        settle(reject, new Error(message));
        if (socket.readyState < WebSocket.CLOSING) socket.close();
      };
      const timeout = globalThis.setTimeout(
        () => fail("Сервер комнат не ответил."),
        CONNECTION_TIMEOUT_MS
      );

      socket.onopen = () => {
        if (!isCurrent()) {
          socket.close(1000, "Stale connection");
          return;
        }
        settle(resolve, normalizedId);
      };
      socket.onmessage = (event) => {
        if (!isCurrent()) return;
        try {
          this.emit(JSON.parse(event.data));
        } catch {
          // A malformed packet must not interrupt the room connection.
        }
      };
      socket.onerror = () => fail("Не удалось подключиться к комнате.");
      socket.onclose = () => {
        const wasCurrent = isCurrent();
        if (wasCurrent) this.socket = null;
        globalThis.clearTimeout(timeout);
        if (!settled) {
          settle(reject, new Error("Соединение с комнатой закрыто."));
        }
        if (wasCurrent) this.emit({ type: "connection-closed" });
      };
    });
  }

  send(type, payload = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type, ...payload }));
    return true;
  }

  disconnect() {
    this.connectionVersion += 1;
    const { socket } = this;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, "Client left room");
    }
  }
}

export { default as OnlineVoiceMesh } from "./onlineVoiceMesh.js";
