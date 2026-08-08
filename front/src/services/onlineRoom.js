const DEFAULT_SIGNALING_URL =
  "wss://karaoke-studio-online.pro100dimka-and.workers.dev";

const CONNECTION_TIMEOUT_MS = 10_000;
const MAX_SIGNAL_MESSAGE_LENGTH = 256 * 1024;
const MAX_PARTICIPANT_NAME_LENGTH = 64;

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
    const parsedUrl = new URL(String(url), DEFAULT_SIGNALING_URL);
    if (parsedUrl.protocol === "http:") parsedUrl.protocol = "ws:";
    if (parsedUrl.protocol === "https:") parsedUrl.protocol = "wss:";
    if (!["ws:", "wss:"].includes(parsedUrl.protocol)) {
      throw new TypeError("Некорректный адрес сервера комнат");
    }
    parsedUrl.username = "";
    parsedUrl.password = "";
    this.url = parsedUrl.toString().replace(/\/$/, "");
    this.listeners = new Set();
    this.socket = null;
    this.connectionVersion = 0;
  }

  onMessage(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("Обработчик сообщений комнаты должен быть функцией");
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(message) {
    for (const listener of this.listeners) {
      try {
        listener(message);
      } catch (error) {
        console.error("Online room listener failed", error);
      }
    }
  }

  connect({ id, name, host = false }) {
    const normalizedId = normalizeRoomId(id);
    if (normalizedId.length < 4) {
      return Promise.reject(
        new Error("Код комнаты должен содержать минимум 4 символа.")
      );
    }

    this.disconnect();
    const { connectionVersion } = this;
    const participantName =
      [...String(name ?? "")]
        .map((character) => {
          const code = character.charCodeAt(0);
          return code <= 31 || code === 127 ? " " : character;
        })
        .join("")
        .trim()
        .slice(0, MAX_PARTICIPANT_NAME_LENGTH) || "Гость";
    const query = new URLSearchParams({
      name: participantName,
      role: host ? "host" : "guest"
    });
    if (typeof globalThis.WebSocket !== "function") {
      return Promise.reject(
        new Error("WebSocket не поддерживается в этом окружении.")
      );
    }
    let socket;
    try {
      socket = new globalThis.WebSocket(
        `${this.url}/rooms/${encodeURIComponent(normalizedId)}?${query}`
      );
    } catch (error) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new Error("Не удалось создать WebSocket-соединение.")
      );
    }
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
        if (socket.readyState < globalThis.WebSocket.CLOSING) socket.close();
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
        if (!isCurrent() || typeof event.data !== "string") return;
        if (event.data.length > MAX_SIGNAL_MESSAGE_LENGTH) {
          socket.close(1009, "Message too large");
          return;
        }
        try {
          const message = JSON.parse(event.data);
          if (!message || typeof message !== "object" || Array.isArray(message))
            return;
          this.emit(message);
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
    const { socket } = this;
    if (socket?.readyState !== 1) return false;
    if (typeof type !== "string" || !type.trim()) return false;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return false;
    }
    try {
      const serialized = JSON.stringify({ ...payload, type: type.trim() });
      if (serialized.length > MAX_SIGNAL_MESSAGE_LENGTH) return false;
      socket.send(serialized);
      return true;
    } catch {
      return false;
    }
  }

  disconnect() {
    this.connectionVersion += 1;
    const { socket } = this;
    this.socket = null;
    if (socket && socket.readyState < 2) {
      socket.close(1000, "Client left room");
    }
  }
}

// Node's direct ESM tests require the explicit source extension.
// eslint-disable-next-line import/extensions
export { default as OnlineVoiceMesh } from "./onlineVoiceMesh.js";
