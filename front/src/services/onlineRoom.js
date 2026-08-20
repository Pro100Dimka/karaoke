// Node's native ESM runner used by contract tests requires the extension.
// eslint-disable-next-line import/extensions
import { translateSaved } from "../i18n/runtime";

export const DEFAULT_SIGNALING_URL = "wss://karaoke-studio-online.pro100dimka-and.workers.dev";
const CONNECTION_TIMEOUT_MS = 10_000;
// Many home routers/NATs/corporate firewalls silently drop an idle WebSocket
// after ~30-60s of no traffic (no close frame, no reason -- the client just
// sees an abrupt onclose). Sending a small ping well under that window keeps
// the connection's NAT mapping alive for participants who aren't otherwise
// sending anything (e.g. quietly listening).
const PING_INTERVAL_MS = 20_000;
function getMaxSignalMessageLength() {
  return 256 * 1024;
}
// Must match the "signal" field cap the Cloudflare worker enforces
// (cloudflare/src/worker.js MAX_SIGNAL_BYTES) -- it's tighter than the general
// per-message limit above, so an oversized WebRTC signal that passes the
// general check would still get the worker to close the whole socket.
const MAX_SIGNAL_PAYLOAD_LENGTH = 64 * 1024;
const MAX_PARTICIPANT_NAME_LENGTH = 40;
const utf8ByteLength = (value) => new TextEncoder().encode(value).byteLength;
export function createRoomId(cryptoApi = globalThis.crypto, random = Math.random) {
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  }
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(6));
    return [...bytes]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }
  const high = Math.floor(random() * 0x1_0000);
  const low = Math.floor(random() * 0x1_0000_0000);
  return `${high.toString(16).padStart(4, "0")}${low.toString(16).padStart(8, "0")}`.toUpperCase();
}
export function createHostToken(cryptoApi = globalThis.crypto) {
  if (cryptoApi && typeof cryptoApi.randomUUID === "function")
    return `${cryptoApi.randomUUID()}${cryptoApi.randomUUID()}`.replaceAll("-", "");
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(32));
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  throw new Error(translateSaved("Безопасный генератор случайных чисел недоступен"));
}

export function normalizeRoomId(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 32);
}
function getCloseDetail(event) {
  const reason = event?.reason?.trim();
  if (reason) return `: ${reason}`;
  return event?.code && event.code !== 1006 ? translateSaved("(код {0})", { 0: event.code }) : "";
}

export class OnlineRoomClient {
  constructor(url = DEFAULT_SIGNALING_URL) {
    const parsedUrl = new URL(String(url), DEFAULT_SIGNALING_URL);
    if (parsedUrl.protocol === "http:") parsedUrl.protocol = "ws:";
    if (parsedUrl.protocol === "https:") parsedUrl.protocol = "wss:";
    if (!["ws:", "wss:"].includes(parsedUrl.protocol)) {
      throw new TypeError(translateSaved("Некорректный адрес сервера комнат"));
    }
    parsedUrl.username = "";
    parsedUrl.password = "";
    this.url = parsedUrl.toString().replace(/\/$/, "");
    this.listeners = new Set();
    this.socket = null;
    this.pingTimer = null;
    this.clockOffsetMs = 0;
    this.clockSynchronized = false;
  }

  _stopPing() {
    if (this.pingTimer !== null) {
      globalThis.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  onMessage(listener) {
    if (typeof listener !== "function") {
      throw new TypeError(translateSaved("Обработчик сообщений комнаты должен быть функцией"));
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

  serverNow() {
    return Date.now() + this.clockOffsetMs;
  }

  _sendClockProbe() {
    this.send("ping", { clientTime: Date.now() });
  }

  connect({ id, name, host = false, hostToken = "" }) {
    const normalizedId = normalizeRoomId(id);
    if (normalizedId.length < 4) {
      return Promise.reject(
        new Error(translateSaved("Код комнаты должен содержать минимум 4 символа."))
      );
    }
    this.disconnect();
    const participantName =
      [...String(name ?? "")]
        .map((character) => {
          const code = character.charCodeAt(0);
          return code <= 31 || code === 127 ? " " : character;
        })
        .join("")
        .trim()
        .slice(0, MAX_PARTICIPANT_NAME_LENGTH) || translateSaved("Гость");
    const query = new URLSearchParams({ name: participantName, role: host ? "host" : "guest" });
    if (host) {
      query.set("create", "1");
      query.set("hostToken", String(hostToken));
    }
    if (typeof globalThis.WebSocket !== "function") {
      return Promise.reject(
        new Error(translateSaved("WebSocket не поддерживается в этом окружении."))
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
          : new Error(translateSaved("Не удалось создать WebSocket-соединение."))
      );
    }
    this.socket = socket;
    return new Promise((resolve, reject) => {
      const isCurrent = () => this.socket === socket;
      const settle = (callback, value) => {
        globalThis.clearTimeout(timeout);
        callback(value);
      };
      const fail = (message) => {
        if (!isCurrent()) return;
        this.socket = null;
        settle(reject, new Error(message));
        if (socket.readyState < globalThis.WebSocket.CLOSING) socket.close();
      };
      const timeout = globalThis.setTimeout(
        () => fail(translateSaved("Сервер комнат не ответил.")),
        CONNECTION_TIMEOUT_MS
      );
      socket.onopen = () => {
        if (!isCurrent()) {
          socket.close(1000, "Stale connection");
          return;
        }
        this._stopPing();
        this._sendClockProbe();
        this.pingTimer = globalThis.setInterval(() => this._sendClockProbe(), PING_INTERVAL_MS);
        settle(resolve, normalizedId);
      };
      socket.onmessage = (event) => {
        if (!isCurrent() || typeof event.data !== "string") return;
        if (utf8ByteLength(event.data) > getMaxSignalMessageLength()) {
          socket.close(1009, "Message too large");
          return;
        }
        try {
          const message = JSON.parse(event.data);
          if (typeof message !== "object" || message === null || Array.isArray(message)) return;
          if (
            message.type === "pong" &&
            Number.isFinite(message.serverTime) &&
            Number.isFinite(message.clientTime)
          ) {
            const midpoint = (message.clientTime + Date.now()) / 2;
            const sample = message.serverTime - midpoint;
            this.clockOffsetMs = this.clockSynchronized
              ? this.clockOffsetMs * 0.75 + sample * 0.25
              : sample;
            this.clockSynchronized = true;
          }
          this.emit(message);
        } catch {
          // A malformed packet must not interrupt the room connection.
        }
      };
      socket.onerror = () => {
        // Browsers intentionally hide network details here. onclose normally
        // follows with the WebSocket status, which is more useful to the user.
      };
      socket.onclose = (event) => {
        const wasCurrent = isCurrent();
        if (wasCurrent) {
          this.socket = null;
          this._stopPing();
        }
        globalThis.clearTimeout(timeout);
        const detail = getCloseDetail(event);
        settle(
          reject,
          new Error(
            translateSaved(
              "Не удалось подключиться к серверу комнат{0}. Проверьте интернет, VPN, прокси или брандмауэр.",
              { 0: detail }
            )
          )
        );
        if (wasCurrent) this.emit({ type: "connection-closed" });
      };
    });
  }

  send(type, payload = {}) {
    const { socket } = this;
    if (
      socket?.readyState !== 1 ||
      typeof type !== "string" ||
      !type.trim() ||
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload)
    ) {
      return false;
    }
    try {
      const trimmedType = type.trim();
      if (
        trimmedType === "signal" &&
        utf8ByteLength(JSON.stringify(payload.signal ?? null)) > MAX_SIGNAL_PAYLOAD_LENGTH
      ) {
        return false;
      }
      const serialized = JSON.stringify({ ...payload, type: trimmedType });
      if (utf8ByteLength(serialized) > getMaxSignalMessageLength()) return false;
      socket.send(serialized);
      return true;
    } catch {
      return false;
    }
  }

  disconnect() {
    const { socket } = this;
    this.socket = null;
    this._stopPing();
    if (socket && socket.readyState < 2) socket.close(1000, "Client left room");
  }
}

// Node's direct ESM tests require the explicit source extension.
// eslint-disable-next-line import/extensions
export { default as OnlineVoiceMesh } from "./onlineVoiceMesh";
