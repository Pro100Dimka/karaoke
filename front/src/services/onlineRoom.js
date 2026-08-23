import { translateSaved as translate } from "../i18n/runtime";

export const DEFAULT_SIGNALING_URL = "wss://karaoke-studio-online.pro100dimka-and.workers.dev";
const LIMITS = { connect: 10_000, message: 256 * 1024, name: 40, ping: 20_000, signal: 64 * 1024 };
const bytes = (value) => new TextEncoder().encode(value).byteLength;
const hex = (values) => [...values].map((value) => value.toString(16).padStart(2, "0")).join("");

export function createRoomId(crypto = globalThis.crypto, random = Math.random) {
  if (crypto?.randomUUID) return crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  if (crypto?.getRandomValues) return hex(crypto.getRandomValues(new Uint8Array(6))).toUpperCase();
  const high = Math.floor(random() * 0x1_0000)
    .toString(16)
    .padStart(4, "0");
  const low = Math.floor(random() * 0x1_0000_0000)
    .toString(16)
    .padStart(8, "0");
  return `${high}${low}`.toUpperCase();
}

export function createHostToken(crypto = globalThis.crypto) {
  if (crypto?.randomUUID) return `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  if (crypto?.getRandomValues) return hex(crypto.getRandomValues(new Uint8Array(32)));
  throw new Error(translate("Безопасный генератор случайных чисел недоступен"));
}

export const normalizeRoomId = (value) =>
  String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 32);

function safeUrl(value) {
  const url = new URL(String(value), DEFAULT_SIGNALING_URL);
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  if (!url.protocol.match(/^wss?:$/))
    throw new TypeError(translate("Некорректный адрес сервера комнат"));
  url.username = "";
  url.password = "";
  return url.toString().replace(/\/$/, "");
}

function participantName(value) {
  return (
    [...String(value ?? "")]
      .map((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127 ? " " : character;
      })
      .join("")
      .trim()
      .slice(0, LIMITS.name) || translate("Гость")
  );
}

function closeDetail(event) {
  const reason = event?.reason?.trim();
  if (reason) return `: ${reason}`;
  return event?.code && event.code !== 1006 ? translate("(код {0})", { 0: event.code }) : "";
}

export class OnlineRoomClient {
  constructor(url = DEFAULT_SIGNALING_URL) {
    this.url = safeUrl(url);
    this.listeners = new Set();
    this.socket = null;
    this.pingTimer = null;
    this.clockOffsetMs = 0;
    this.clockSynchronized = false;
  }

  onMessage(listener) {
    if (typeof listener !== "function")
      throw new TypeError(translate("Обработчик сообщений комнаты должен быть функцией"));
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

  stopPing() {
    if (this.pingTimer == null) return;
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  sendClockProbe() {
    this.send("ping", { clientTime: Date.now() });
  }

  connect({ id, name, host = false, hostToken = "" }) {
    const roomId = normalizeRoomId(id);
    if (roomId.length < 4)
      return Promise.reject(
        new Error(translate("Код комнаты должен содержать минимум 4 символа."))
      );
    this.disconnect();
    if (typeof globalThis.WebSocket !== "function")
      return Promise.reject(new Error(translate("WebSocket не поддерживается в этом окружении.")));
    const query = new URLSearchParams({
      name: participantName(name),
      role: host ? "host" : "guest"
    });
    if (host) {
      query.set("create", "1");
      query.set("hostToken", String(hostToken));
    }
    let socket;
    try {
      socket = new WebSocket(`${this.url}/rooms/${encodeURIComponent(roomId)}?${query}`);
    } catch (error) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new Error(translate("Не удалось создать WebSocket-соединение."))
      );
    }
    this.socket = socket;
    return new Promise((resolve, reject) => {
      const current = () => this.socket === socket;
      const settle = (callback, value) => {
        clearTimeout(timeout);
        callback(value);
      };
      const fail = (message) => {
        if (!current()) return;
        this.socket = null;
        settle(reject, new Error(message));
        if (socket.readyState < WebSocket.CLOSING) socket.close();
      };
      const timeout = setTimeout(
        () => fail(translate("Сервер комнат не ответил.")),
        LIMITS.connect
      );
      socket.onopen = () => {
        if (!current()) return socket.close(1000, "Stale connection");
        this.stopPing();
        this.sendClockProbe();
        this.pingTimer = setInterval(() => this.sendClockProbe(), LIMITS.ping);
        settle(resolve, roomId);
      };
      socket.onmessage = ({ data }) => {
        if (!current() || typeof data !== "string") return;
        if (bytes(data) > LIMITS.message) return socket.close(1009, "Message too large");
        try {
          const message = JSON.parse(data);
          if (!message || typeof message !== "object" || Array.isArray(message)) return;
          if (
            message.type === "pong" &&
            Number.isFinite(message.serverTime) &&
            Number.isFinite(message.clientTime)
          ) {
            const sample = message.serverTime - (message.clientTime + Date.now()) / 2;
            this.clockOffsetMs = this.clockSynchronized
              ? this.clockOffsetMs * 0.75 + sample * 0.25
              : sample;
            this.clockSynchronized = true;
          }
          this.emit(message);
        } catch {
          // Malformed packets do not own the room connection.
        }
      };
      socket.onerror = () => {};
      socket.onclose = (event) => {
        const wasCurrent = current();
        if (wasCurrent) {
          this.socket = null;
          this.stopPing();
        }
        settle(
          reject,
          new Error(
            translate(
              "Не удалось подключиться к серверу комнат{0}. Проверьте интернет, VPN, прокси или брандмауэр.",
              { 0: closeDetail(event) }
            )
          )
        );
        if (wasCurrent) this.emit({ type: "connection-closed" });
      };
    });
  }

  send(type, payload = {}) {
    if (
      this.socket?.readyState !== 1 ||
      typeof type !== "string" ||
      !type.trim() ||
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload)
    )
      return false;
    try {
      const normalized = type.trim();
      if (normalized === "signal" && bytes(JSON.stringify(payload.signal ?? null)) > LIMITS.signal)
        return false;
      const packet = JSON.stringify({ ...payload, type: normalized });
      if (bytes(packet) > LIMITS.message) return false;
      this.socket.send(packet);
      return true;
    } catch {
      return false;
    }
  }

  disconnect() {
    const { socket } = this;
    this.socket = null;
    this.stopPing();
    if (socket?.readyState < 2) socket.close(1000, "Client left room");
  }
}

export { default as OnlineVoiceMesh } from "./onlineVoiceMesh";
