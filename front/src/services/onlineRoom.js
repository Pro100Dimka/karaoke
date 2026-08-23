import { translateSaved as translate } from "../i18n/runtime";

export const DEFAULT_SIGNALING_URL = "wss://karaoke-studio-online.pro100dimka-and.workers.dev";
const LIMITS = {
  connect: 10_000,
  message: 256 * 1024,
  name: 40,
  ping: 20_000,
  reconnectAttempts: 8,
  reconnectBase: 500,
  reconnectMax: 8_000,
  signal: 64 * 1024,
  sendBurst: 70,
  sendWindow: 10_000
};
const RETRYABLE_CLOSE_CODES = new Set([1001, 1006, 1011, 1012, 1013]);
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

function closeReason(event) {
  const reason = event?.reason?.trim();
  if (reason) return reason;
  if (event?.code === 1006)
    return translate("Соединение с сервером комнат неожиданно прервано.");
  if (event?.code) return translate("Соединение с комнатой закрыто (код {0}).", { 0: event.code });
  return translate("Соединение с комнатой потеряно.");
}

export class OnlineRoomClient {
  constructor(url = DEFAULT_SIGNALING_URL) {
    this.url = safeUrl(url);
    this.listeners = new Set();
    this.socket = null;
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.connectionOptions = null;
    this.manualDisconnect = false;
    this.sendTimes = [];
    this.sendQueue = [];
    this.sendQueueTimer = null;
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

  stopReconnect() {
    if (this.reconnectTimer == null) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  clearSendQueue() {
    if (this.sendQueueTimer != null) clearTimeout(this.sendQueueTimer);
    this.sendQueueTimer = null;
    this.sendQueue = [];
    this.sendTimes = [];
  }

  flushSendQueue() {
    if (this.socket?.readyState !== 1) return;
    const now = Date.now();
    this.sendTimes = this.sendTimes.filter((time) => now - time < LIMITS.sendWindow);
    while (this.sendQueue.length && this.sendTimes.length < LIMITS.sendBurst) {
      const { packet } = this.sendQueue.shift();
      try {
        this.socket.send(packet);
        this.sendTimes.push(Date.now());
      } catch {
        break;
      }
    }
    if (!this.sendQueue.length || this.sendQueueTimer != null) return;
    const wait = Math.max(50, LIMITS.sendWindow - (Date.now() - this.sendTimes[0]) + 50);
    this.sendQueueTimer = setTimeout(() => {
      this.sendQueueTimer = null;
      this.flushSendQueue();
    }, wait);
  }

  queuePacket(packet, type) {
    const now = Date.now();
    this.sendTimes = this.sendTimes.filter((time) => now - time < LIMITS.sendWindow);
    if (this.sendTimes.length < LIMITS.sendBurst && !this.sendQueue.length) {
      this.socket.send(packet);
      this.sendTimes.push(now);
      return true;
    }
    if (type === "ui") this.sendQueue = this.sendQueue.filter((entry) => entry.type !== "ui");
    this.sendQueue.push({ packet, type });
    this.flushSendQueue();
    return true;
  }

  sendClockProbe() {
    this.send("ping", { clientTime: Date.now() });
  }

  buildSocketUrl(options) {
    const query = new URLSearchParams({
      name: options.name,
      role: options.host ? "host" : "guest"
    });
    if (options.host) {
      query.set("create", "1");
      query.set("hostToken", options.hostToken);
    }
    return `${this.url}/rooms/${encodeURIComponent(options.roomId)}?${query}`;
  }

  shouldReconnect(event) {
    if (this.manualDisconnect || !this.connectionOptions) return false;
    const code = Number(event?.code) || 1006;
    return RETRYABLE_CLOSE_CODES.has(code) && this.reconnectAttempts < LIMITS.reconnectAttempts;
  }

  scheduleReconnect(event) {
    if (!this.shouldReconnect(event)) {
      this.emit({ type: "connection-closed", reason: closeReason(event), code: event?.code || 1006 });
      return;
    }
    this.reconnectAttempts += 1;
    const delay = Math.min(
      LIMITS.reconnectMax,
      LIMITS.reconnectBase * 2 ** Math.max(0, this.reconnectAttempts - 1)
    );
    this.emit({
      type: "connection-reconnecting",
      attempt: this.reconnectAttempts,
      delay,
      code: event?.code || 1006,
      reason: closeReason(event)
    });
    this.stopReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.manualDisconnect || !this.connectionOptions) return;
      this.openSocket(this.connectionOptions, { reconnect: true }).catch(() => {});
    }, delay);
  }

  openSocket(options, { reconnect = false } = {}) {
    let socket;
    try {
      socket = new WebSocket(this.buildSocketUrl(options));
    } catch (error) {
      if (reconnect) {
        this.scheduleReconnect({ code: 1006, reason: error instanceof Error ? error.message : "" });
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return Promise.reject(
        error instanceof Error
          ? error
          : new Error(translate("Не удалось создать WebSocket-соединение."))
      );
    }
    this.socket = socket;
    return new Promise((resolve, reject) => {
      let opened = false;
      let settled = false;
      const current = () => this.socket === socket;
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        callback(value);
      };
      const fail = (message) => {
        if (!current()) return;
        this.socket = null;
        settle(reject, new Error(message));
        if (socket.readyState < WebSocket.CLOSING) socket.close();
        if (reconnect && !this.manualDisconnect)
          this.scheduleReconnect({ code: 1006, reason: message });
      };
      const timeout = setTimeout(
        () => fail(translate("Сервер комнат не ответил.")),
        LIMITS.connect
      );

      socket.onopen = () => {
        if (!current()) return socket.close(1000, "Stale connection");
        opened = true;
        this.stopPing();
        this.reconnectAttempts = 0;
        this.sendClockProbe();
        this.pingTimer = setInterval(() => this.sendClockProbe(), LIMITS.ping);
        settle(resolve, options.roomId);
        if (reconnect) this.emit({ type: "connection-reconnected" });
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

      socket.onerror = (event) => {
        console.warn("Online room WebSocket error", {
          roomId: options.roomId,
          reconnect,
          readyState: socket.readyState,
          event
        });
      };

      socket.onclose = (event = {}) => {
        const wasCurrent = current();
        if (wasCurrent) {
          this.socket = null;
          this.stopPing();
          this.clearSendQueue();
        }
        if (!opened) {
          settle(
            reject,
            new Error(
              translate(
                "Не удалось подключиться к серверу комнат{0}. Проверьте интернет, VPN, прокси или брандмауэр.",
                { 0: closeDetail(event) }
              )
            )
          );
        }
        if (!wasCurrent || this.manualDisconnect) return;
        if (opened || reconnect) this.scheduleReconnect(event);
        else this.emit({ type: "connection-closed", reason: closeReason(event), code: event.code || 1006 });
      };
    });
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
    this.manualDisconnect = false;
    this.reconnectAttempts = 0;
    this.connectionOptions = {
      roomId,
      name: participantName(name),
      host: Boolean(host),
      hostToken: String(hostToken)
    };
    return this.openSocket(this.connectionOptions);
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
      return this.queuePacket(packet, normalized);
    } catch {
      return false;
    }
  }

  disconnect() {
    this.manualDisconnect = true;
    this.connectionOptions = null;
    this.reconnectAttempts = 0;
    this.stopReconnect();
    this.clearSendQueue();
    const { socket } = this;
    this.socket = null;
    this.stopPing();
    if (socket?.readyState < 2) socket.close(1000, "Client left room");
  }
}

export { default as OnlineVoiceMesh } from "./onlineVoiceMesh";
