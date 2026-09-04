import { translateSaved as translate } from "../i18n/runtime";
import { ROOM_PROTOCOL_VERSION } from "./roomProtocol";

export { ROOM_PROTOCOL_VERSION } from "./roomProtocol";

export const isValidSongRevision = (revision) =>
  typeof revision === "string" && revision.startsWith("sha256:");

export const DEFAULT_SIGNALING_URL = "wss://karaoke-studio-online.pro100dimka-and.workers.dev";
// Keep in sync with ROOM_PROTOCOL_VERSION in cloudflare/src/worker.js -- bump
// both together only when the message schema itself changes incompatibly.
const LIMITS = { connect: 10_000, message: 256 * 1024, name: 40, ping: 3_000, signal: 64 * 1024 };
const CLOCK_SAMPLE_LIMIT = 8;
const RECONNECT_WINDOW_MS = 45_000;
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
  throw new Error(translate("room.secureRandomNumberGeneratorUnavailable"));
}

const GUEST_SESSION_STORAGE_KEY = "advoice-online-room-session-id";

// A brief network drop shouldn't make a guest look like a brand new person
// to everyone else in the room -- the worker reclaims their previous
// participant id (and therefore their volume/mute/effect settings in every
// other client) for a reconnect carrying the same session id. sessionStorage
// keeps this stable across a reconnect within the same running app/tab, but
// starts fresh after a full app restart, matching the room-recovery
// contract: membership does not silently resume after the app relaunches.
export function getOrCreateGuestSessionId(
  storage = globalThis.sessionStorage,
  crypto = globalThis.crypto
) {
  try {
    const existing = storage?.getItem(GUEST_SESSION_STORAGE_KEY);
    if (existing) return existing;
    const created = crypto?.randomUUID
      ? crypto.randomUUID()
      : crypto?.getRandomValues
        ? hex(crypto.getRandomValues(new Uint8Array(16)))
        : "";
    if (created) storage?.setItem(GUEST_SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    // sessionStorage may be unavailable (privacy mode, restricted context);
    // reconnect identity is a nice-to-have, not required for the room to work.
    return crypto?.randomUUID ? crypto.randomUUID() : "";
  }
}

export const normalizeRoomId = (value) =>
  String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 32);

export function shouldApplyRoomEvent(ordering, message) {
  if (message.type === "room-state") {
    if (typeof message.roomEpoch !== "string" || !message.roomEpoch) return true;
    if (ordering.roomEpoch !== message.roomEpoch) ordering.lastAppliedSequence = 0;
    ordering.roomEpoch = message.roomEpoch;
    ordering.lastAppliedSequence = Math.max(
      ordering.lastAppliedSequence,
      Number.isSafeInteger(message.eventSequence) ? message.eventSequence : 0
    );
    ordering.snapshotVersion = Number.isSafeInteger(message.snapshotVersion)
      ? message.snapshotVersion
      : 0;
    return true;
  }
  if (message.roomEpoch === undefined && message.eventSequence === undefined) return true;
  if (
    message.roomEpoch !== ordering.roomEpoch ||
    !Number.isSafeInteger(message.eventSequence) ||
    message.eventSequence <= ordering.lastAppliedSequence
  )
    return false;
  ordering.lastAppliedSequence = message.eventSequence;
  if (Number.isSafeInteger(message.snapshotVersion))
    ordering.snapshotVersion = Math.max(ordering.snapshotVersion, message.snapshotVersion);
  return true;
}

function safeUrl(value) {
  const url = new URL(String(value), DEFAULT_SIGNALING_URL);
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  if (!url.protocol.match(/^wss?:$/))
    throw new TypeError(translate("room.invalidRoomServerAddress"));
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
      .slice(0, LIMITS.name) || translate("room.guest")
  );
}

function closeDetail(event) {
  const reason = event?.reason?.trim();
  if (reason) return `: ${reason}`;
  return event?.code && event.code !== 1006 ? translate("room.code2", { 0: event.code }) : "";
}

export class OnlineRoomClient {
  constructor(url = DEFAULT_SIGNALING_URL) {
    this.url = safeUrl(url);
    this.listeners = new Set();
    this.socket = null;
    this.pingTimer = null;
    this.clockOffsetMs = 0;
    this.clockSynchronized = false;
    this.clockSamples = [];
    this.connectionOptions = null;
    this.reconnectTimer = null;
    this.reconnectDeadline = 0;
    this.reconnectAttempt = 0;
    this.joined = false;
    this.privateUi = {};
    this.presence = null;
    this.effectPermission = null;
    this.pendingControl = new Map();
    this.lastMessageAt = 0;
    this.iceConfig = null;
    this.iceRequest = null;
    this.guestSessionId = null;
    this.ordering = { roomEpoch: "", lastAppliedSequence: 0, snapshotVersion: 0 };
    this.clientSequence = 0;
  }

  onMessage(listener) {
    if (typeof listener !== "function")
      throw new TypeError(translate("room.theRoomMessageHandlerMustBeAFunction"));
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
    if (this.joined && this.lastMessageAt && Date.now() - this.lastMessageAt > 12_000) {
      const stale = this.socket;
      this.socket = null;
      this.stopPing();
      stale?.close(4001, "Heartbeat timeout");
      this.scheduleReconnect();
      return;
    }
    this.send("ping", { clientTime: Date.now() });
  }

  getIceServers({ force = false } = {}) {
    if (!force && this.iceConfig?.expiresAt > Date.now() + 30_000)
      return Promise.resolve(this.iceConfig.iceServers);
    if (this.iceRequest) return this.iceRequest.promise;
    const requestId = globalThis.crypto?.randomUUID?.() || `ice-${Date.now()}`;
    let finish;
    const promise = new Promise((resolve) => {
      finish = resolve;
    });
    const fallback = [{ urls: "stun:stun.cloudflare.com:3478" }];
    const settle = (config) => {
      clearTimeout(timer);
      unsubscribe();
      this.iceRequest = null;
      this.iceConfig = config;
      if (config.warning) this.emit({ type: "error", message: config.warning });
      finish(config.iceServers);
    };
    const unsubscribe = this.onMessage((message) => {
      if (
        message.type !== "ice-config" ||
        message.requestId !== requestId ||
        !Array.isArray(message.iceServers)
      )
        return;
      settle(message);
    });
    const timer = setTimeout(
      () =>
        settle({
          iceServers: fallback,
          expiresAt: Date.now() + 60_000,
          warning: translate("room.turnSettingsUnavailableTryingADirectConnection")
        }),
      6000
    );
    this.iceRequest = { promise, cancel: () => settle({ iceServers: fallback, expiresAt: 0 }) };
    if (!this.send("ice-config-request", { requestId })) this.iceRequest.cancel();
    return promise;
  }

  scheduleReconnect() {
    if (!this.connectionOptions || this.reconnectTimer !== null) return;
    if (!this.reconnectDeadline) {
      this.reconnectDeadline = Date.now() + RECONNECT_WINDOW_MS;
      this.emit({ type: "connection-reconnecting" });
    }
    const remaining = this.reconnectDeadline - Date.now();
    if (remaining <= 0) {
      this.connectionOptions = null;
      this.emit({ type: "connection-closed" });
      return;
    }
    const delay = Math.min(500 * 2 ** Math.min(this.reconnectAttempt++, 3), remaining);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.connectionOptions) return;
      if (Date.now() >= this.reconnectDeadline) return this.scheduleReconnect();
      this.connect(this.connectionOptions, true).catch(() => this.scheduleReconnect());
    }, delay);
  }

  connect({ id, name, host = false, hostToken = "" }, reconnect = false) {
    const roomId = normalizeRoomId(id);
    if (roomId.length < 4)
      return Promise.reject(new Error(translate("room.theRoomCodeMustContainAtLeast4Characters")));
    if (!reconnect) {
      this.disconnect();
      this.connectionOptions = { id, name, host, hostToken };
    }
    if (!reconnect) {
      this.clockOffsetMs = 0;
      this.clockSynchronized = false;
      this.ordering = { roomEpoch: "", lastAppliedSequence: 0, snapshotVersion: 0 };
      this.clientSequence = 0;
    }
    this.clockSamples = [];
    if (typeof globalThis.WebSocket !== "function")
      return Promise.reject(new Error(translate("room.websocketIsNotSupportedInThisEnvironment")));
    const query = new URLSearchParams({
      name: participantName(name),
      role: host ? "host" : "guest",
      v: String(ROOM_PROTOCOL_VERSION)
    });
    if (host) {
      // A reconnect may resume an existing room, never resurrect an expired one.
      if (!reconnect) query.set("create", "1");
    } else {
      const sessionId = this.guestSessionId || getOrCreateGuestSessionId();
      this.guestSessionId = sessionId;
      if (sessionId) query.set("sessionId", sessionId);
    }
    let socket;
    try {
      socket = new WebSocket(`${this.url}/rooms/${encodeURIComponent(roomId)}?${query}`);
    } catch (error) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new Error(translate("room.failedToCreateWebsocketConnection"))
      );
    }
    this.socket = socket;
    this.lastMessageAt = Date.now();
    return new Promise((resolve, reject) => {
      const current = () => this.socket === socket;
      const settle = (callback, value) => {
        clearTimeout(timeout);
        callback(value);
      };
      const fail = (message) => {
        if (!current()) return;
        this.socket = null;
        this.stopPing();
        settle(reject, new Error(message));
        if (socket.readyState < WebSocket.CLOSING) socket.close();
      };
      const timeout = setTimeout(
        () => fail(translate("room.theRoomServerDidNotRespond")),
        reconnect
          ? Math.min(LIMITS.connect, Math.max(1, this.reconnectDeadline - Date.now()))
          : LIMITS.connect
      );
      socket.onopen = () => {
        if (!current()) return socket.close(1000, "Stale connection");
        if (host) socket.send(JSON.stringify({ type: "host-auth", hostToken: String(hostToken) }));
      };
      socket.onmessage = ({ data }) => {
        if (!current() || typeof data !== "string") return;
        if (bytes(data) > LIMITS.message) return socket.close(1009, "Message too large");
        try {
          const message = JSON.parse(data);
          if (!message || typeof message !== "object" || Array.isArray(message)) return;
          if (!shouldApplyRoomEvent(this.ordering, message)) return;
          if (message.type === "room-state" && Number.isSafeInteger(message.lastClientSequence))
            this.clientSequence = Math.max(this.clientSequence, message.lastClientSequence);
          this.lastMessageAt = Date.now();
          if (message.type === "room-closed") {
            this.connectionOptions = null;
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
          }
          if (
            message.type === "pong" &&
            Number.isFinite(message.serverTime) &&
            Number.isFinite(message.clientTime)
          ) {
            const receivedAt = Date.now();
            const roundTripMs = receivedAt - message.clientTime;
            if (roundTripMs >= 0 && roundTripMs <= LIMITS.connect) {
              const offsetMs = message.serverTime - (message.clientTime + receivedAt) / 2;
              this.clockSamples.push({ offsetMs, roundTripMs });
              if (this.clockSamples.length > CLOCK_SAMPLE_LIMIT) this.clockSamples.shift();
              // The lowest-RTT NTP sample has the smallest possible queueing
              // error. Smoothing arbitrary samples made two clients disagree
              // by tens of milliseconds whenever one WebSocket packet waited
              // in a network queue -- enough to hear two singers drift apart.
              const best = this.clockSamples.reduce((current, sample) =>
                sample.roundTripMs < current.roundTripMs ? sample : current
              );
              this.clockOffsetMs = best.offsetMs;
              this.clockSynchronized = true;
            }
          }
          this.emit(message);
          if (message.type === "room-state") {
            this.joined = true;
            this.stopPing();
            this.sendClockProbe();
            this.pingTimer = setInterval(() => this.sendClockProbe(), LIMITS.ping);
            if (reconnect) {
              this.reconnectDeadline = 0;
              this.reconnectAttempt = 0;
              if (Object.keys(this.privateUi).length) this.send("ui", { state: this.privateUi });
              if (this.presence) this.send("presence", this.presence);
              if (this.effectPermission) this.send("effect-permission", this.effectPermission);
              for (const payload of this.pendingControl.values()) this.send("sync", payload);
              this.pendingControl.clear();
              this.emit({ type: "connection-restored" });
            }
            settle(resolve, roomId);
          }
        } catch {
          // Malformed packets do not own the room connection.
        }
      };
      socket.onerror = () => {};
      socket.onclose = (event) => {
        const wasCurrent = current();
        console.error("Room WebSocket closed", {
          code: event?.code,
          reason: event?.reason || null,
          wasClean: event?.wasClean ?? null
        });
        if (wasCurrent) {
          this.socket = null;
          this.stopPing();
        }
        settle(
          reject,
          new Error(
            translate("room.failedToConnectToRoomServerCheckYourInternet", {
              0: closeDetail(event)
            })
          )
        );
        if (wasCurrent) {
          const terminal = [1008, 1009, 4000].includes(event?.code);
          if (!terminal && this.joined && this.connectionOptions) this.scheduleReconnect();
          else if (!reconnect || terminal) {
            this.connectionOptions = null;
            this.emit({ type: "connection-closed" });
          }
        }
      };
    });
  }

  send(type, payload = {}) {
    if (type === "ui" && payload?.state) {
      for (const key of ["songs", "participantEffects"]) {
        if (Object.hasOwn(payload.state, key)) this.privateUi[key] = payload.state[key];
      }
    }
    if (type === "presence") this.presence = payload;
    if (type === "effect-permission") this.effectPermission = payload;
    if (
      this.reconnectDeadline &&
      type === "sync" &&
      ["song-ready", "song-request"].includes(payload?.state?.type)
    ) {
      this.pendingControl.set(payload.state.type, payload);
    }
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
      const ordered =
        this.ordering.roomEpoch &&
        ["ui", "sync", "presence", "effect-permission"].includes(normalized)
          ? {
              roomEpoch: this.ordering.roomEpoch,
              clientSequence: (this.clientSequence += 1)
            }
          : {};
      const packet = JSON.stringify({ ...payload, ...ordered, type: normalized });
      if (bytes(packet) > LIMITS.message) return false;
      this.socket.send(packet);
      return true;
    } catch {
      return false;
    }
  }

  disconnect() {
    this.connectionOptions = null;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectDeadline = 0;
    this.reconnectAttempt = 0;
    this.joined = false;
    this.privateUi = {};
    this.ordering = { roomEpoch: "", lastAppliedSequence: 0, snapshotVersion: 0 };
    this.clientSequence = 0;
    this.pendingControl.clear();
    this.iceRequest?.cancel();
    this.iceConfig = null;
    const { socket } = this;
    this.socket = null;
    this.stopPing();
    if (socket?.readyState < 2) socket.close(1000, "Client left room");
  }
}

export { default as OnlineVoiceMesh } from "./onlineVoiceMesh";
