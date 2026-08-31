import { generateRoomIce } from "./roomIce.js";

const MAX_ROOM_ID_LENGTH = 32;
const MAX_NAME_LENGTH = 40;
const MAX_MESSAGE_BYTES = 256 * 1024;
const MAX_PARTICIPANTS = 12;
const RATE_WINDOW_MS = 10_000;
const RATE_LIMIT = 160;
const HOST_RATE_LIMIT = 480;
const SIGNAL_RATE_LIMIT = 400;
const MAX_SIGNAL_BYTES = 64 * 1024;
const MAX_STATE_BYTES = 128 * 1024;
const MAX_LOG_BYTES = 32 * 1024;
const MAX_DEVICE_LOG_EVENTS = 10_000;
const LOG_RATE_WINDOW_MS = 60_000;
const LOG_RATE_LIMIT = 30;
const MAX_ROOM_SONGS = 500;
// A transport failure is not an explicit decision to leave the room.
const GUEST_RECONNECT_GRACE_MS = 45_000;
const HOST_RECONNECT_GRACE_MS = 45_000;
// Bumped only when the message schema itself changes incompatibly (a field
// renamed/removed/retyped in a message the other side must understand) --
// not on every worker/frontend release. Without this, an old frontend build
// talking to a newer worker (or vice versa) after such a change would just
// silently drop/misinterpret messages instead of failing the connection with
// an explicit reason.
export const ROOM_PROTOCOL_VERSION = 2;
const HOST_AUTH_TIMEOUT_MS = 10_000;
export const EFFECT_LIMITS = Object.freeze({
  volume: 2,
  reverb: 1,
  echo: 1,
  delay: 1,
  noise_suppression: 1,
  octave: 1,
});

export function normalizeParticipantEffects(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const effects = {};
  for (const [name, maximum] of Object.entries(EFFECT_LIMITS)) {
    if (!Object.hasOwn(value, name)) continue;
    const number = Number(value[name]);
    if (Number.isFinite(number)) effects[name] = Math.max(name === "octave" ? -1 : 0, Math.min(maximum, number));
  }
  return Object.keys(effects).length ? effects : null;
}

const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);
const SHARED_UI_KEYS = ["query", "filters", "radio", "karaoke"];
const uiText = (value) => typeof value === "string" && value.length <= 200;
const uiBool = (value) => typeof value === "boolean";
const uiNumber = (min, max) => (value) => Number.isFinite(value) && value >= min && value <= max;
const UI_SCHEMAS = {
  filters: { genre: uiText, key: uiText, status: uiText, sort: uiText },
  radio: { stationId: uiText, isPlaying: uiBool, volume: uiNumber(0, 1) },
  karaoke: {
    musicVolume: uiNumber(0, 1), vocalVolume: uiNumber(0, 1), melodyVolume: uiNumber(0, 1),
    speed: uiNumber(0.5, 1.5), keyShift: uiNumber(-12, 12), effectPreset: uiText,
    showLyrics: uiBool, showNotes: uiBool, autoHideConsole: uiBool,
  },
};
export function normalizeRoomUi(value) {
  if (!isRecord(value)) return null;
  const state = {};
  if (typeof value.query === "string" && value.query.length <= 500) state.query = value.query;
  // Only these namespaces are shared. Identity, roles and per-person maps
  // are always assigned by the server, never accepted from a client.
  for (const key of ["filters", "radio", "karaoke"]) {
    if (!isRecord(value[key])) continue;
    const fields = Object.entries(UI_SCHEMAS[key]).filter(([name, valid]) => Object.hasOwn(value[key], name) && valid(value[key][name]));
    if (fields.length) state[key] = Object.fromEntries(fields.map(([name]) => [name, value[key][name]]));
  }
  const effects = normalizeParticipantEffects(value.participantEffects);
  if (effects) state.participantEffects = effects;
  if (Array.isArray(value.songs) && value.songs.length <= MAX_ROOM_SONGS && value.songs.every(isRecord))
    state.songs = value.songs;
  return Object.keys(state).length ? state : null;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });
}

function normalizeRoomId(value) {
  const roomId = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9_-]{4,32}$/.test(roomId) ? roomId : null;
}

function normalizeName(value) {
  const name = String(value || "Гость").trim().replace(/\s+/g, " ");
  return (name || "Гость").slice(0, MAX_NAME_LENGTH);
}

function participantFromSocket(socket) {
  return socket.deserializeAttachment();
}

// recentGuests is sessionToken -> { id, disconnectedAt }, for guests only.
// Exported as plain functions over a Map (rather than KaraokeRoom methods)
// so the grace-window/one-time-consumption logic is testable without
// standing up the Durable Object's WebSocket/storage runtime.
export function pruneRecentGuests(recentGuests, now = Date.now()) {
  const cutoff = now - GUEST_RECONNECT_GRACE_MS;
  for (const [token, entry] of recentGuests) {
    if (entry.disconnectedAt < cutoff) recentGuests.delete(token);
  }
}

export function reclaimGuestId(recentGuests, sessionToken, now = Date.now()) {
  pruneRecentGuests(recentGuests, now);
  if (!sessionToken) return null;
  const entry = recentGuests.get(sessionToken);
  if (!entry) return null;
  recentGuests.delete(sessionToken);
  return entry.id;
}

export class KaraokeRoom {
  constructor(ctx, env = {}) {
    this.ctx = ctx;
    this.env = env;
    this.rate = new Map();
    this.recentGuests = new Map();
    this.playbackState = null;
    this.sharedUi = {};
    this.hostParticipant = null;
    this.hostDeadline = null;
    this.iceCredentials = new Map();
    this.admission = Promise.resolve();
    const restore = async () => {
      if (!ctx.storage?.get) return;
      this.sharedUi = (await ctx.storage.get("sharedUi")) || {};
      this.playbackState = (await ctx.storage.get("playbackState")) || null;
      this.hostParticipant = (await ctx.storage.get("hostParticipant")) || null;
      this.hostDeadline = (await ctx.storage.get("hostDeadline")) || null;
      this.recentGuests = new Map((await ctx.storage.get("recentGuests")) || []);
    };
    this.ready = ctx.blockConcurrencyWhile ? ctx.blockConcurrencyWhile(restore) : restore();
  }

  reject(socket, message = "Некорректное сообщение комнаты.") {
    this.send(socket, "error", { message });
    socket.close(1008, message.slice(0, 120));
  }

  reportInvalid(socket, message = "Некорректное сообщение комнаты.") {
    // A stale/oversized UI snapshot must not destroy a live karaoke session.
    // Ignore it and report an error while media/voice connections stay alive.
    this.send(socket, "error", { message });
  }

  withinRate(id, role, type) {
    const now = Date.now();
    const channel = type === "signal" ? "signal" : type === "ping" ? "ping" : "control";
    const key = `${id}:${channel}`;
    const limit = channel === "signal" ? SIGNAL_RATE_LIMIT : channel === "ping" ? 20 : role === "host" ? HOST_RATE_LIMIT : RATE_LIMIT;
    const entry = this.rate.get(key) || { startedAt: now, count: 0 };
    if (now - entry.startedAt >= RATE_WINDOW_MS) { entry.startedAt = now; entry.count = 0; }
    entry.count += 1; this.rate.set(key, entry);
    return entry.count <= limit;
  }

  participants() {
    const connected = this.ctx
      .getWebSockets()
      .map(participantFromSocket)
      .filter((participant) => participant?.role === "host" || participant?.role === "guest")
      .map(({ id, name, role, micMuted = false, effectsLocked = false }) => ({
        id,
        name,
        role,
        micMuted,
        effectsLocked,
      }));
    if (this.hostDeadline && this.hostParticipant && !connected.some(({ role }) => role === "host"))
      connected.push({ ...this.hostParticipant, reconnecting: true });
    return connected;
  }

  send(socket, type, payload) {
    try { socket.send(JSON.stringify({ type, ...payload })); }
    catch { /* A closing socket must not interrupt broadcasts to healthy peers. */ }
  }

  broadcast(type, payload, exceptId = null) {
    for (const socket of this.ctx.getWebSockets()) {
      const participant = participantFromSocket(socket);
      if (!participant || !["host", "guest"].includes(participant.role) || participant.id === exceptId) continue;
      this.send(socket, type, payload);
    }
  }

  async fetch(request) {
    await this.ready;
    if (this.hostDeadline && this.hostDeadline <= Date.now()) await this.alarm();
    const previousAdmission = this.admission;
    let releaseAdmission;
    this.admission = new Promise((resolve) => { releaseAdmission = resolve; });
    await previousAdmission;
    try {
      return await this.acceptUpgrade(request);
    } finally {
      releaseAdmission();
    }
  }

  async acceptUpgrade(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "WebSocket upgrade required" }, 426);
    }
    const url = new URL(request.url);
    const clientVersion = Number.parseInt(url.searchParams.get("v") || "", 10);
    if (clientVersion !== ROOM_PROTOCOL_VERSION) {
      return json({ error: "Unsupported room protocol version", expected: ROOM_PROTOCOL_VERSION }, 400);
    }
    const requestedRole = url.searchParams.get("role") === "host" ? "host" : "guest";
    for (const socket of this.ctx.getWebSockets()) {
      const participant = participantFromSocket(socket);
      if (participant?.role === "pending-host" && participant.authDeadline <= Date.now()) {
        try { socket.close(1008, "Host authentication timed out"); } catch { /* Already closed. */ }
      }
    }
    const connectedSockets = this.ctx.getWebSockets().filter((socket) => {
      const participant = participantFromSocket(socket);
      return participant?.role !== "pending-host" || participant.authDeadline > Date.now();
    });
    const currentParticipants = this.participants();
    const resumingHost = requestedRole === "host" && this.hostDeadline;
    if (connectedSockets.length >= MAX_PARTICIPANTS && !resumingHost) return json({ error: "Room is full" }, 429);
    let role = "guest";
    if (requestedRole === "host") {
      if (connectedSockets.some((socket) => ["host", "pending-host"].includes(participantFromSocket(socket)?.role)))
        return json({ error: "Host is already connected" }, 409);
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.serializeAttachment({
        id: crypto.randomUUID(),
        name: normalizeName(url.searchParams.get("name")),
        role: "pending-host",
        create: url.searchParams.get("create") === "1",
        resumingHost: Boolean(resumingHost),
        authDeadline: Date.now() + HOST_AUTH_TIMEOUT_MS,
      });
      this.ctx.acceptWebSocket(server);
      this.send(server, "host-auth-required", {});
      return new Response(null, { status: 101, webSocket: client });
    } else if (!(await this.ctx.storage.get("hostToken"))) {
      return json({ error: "Room is closed" }, 404);
    }
    // A guest that reconnects within the grace window (see
    // GUEST_RECONNECT_GRACE_MS) reclaims their previous id instead of
    // getting a fresh one, so the volume/mute/effect settings every other
    // client already has recorded for that id keep applying -- otherwise
    // reconnecting looked exactly like a brand new person joining.
    const sessionToken = String(url.searchParams.get("sessionId") || "").slice(0, 128);
    const reclaimedId = role === "guest" ? reclaimGuestId(this.recentGuests, sessionToken) : null;
    const publicParticipant = {
      id: (role === "host" && this.hostParticipant?.id) || reclaimedId || crypto.randomUUID(),
      name: normalizeName(url.searchParams.get("name")),
      role,
      micMuted: role === "host" ? Boolean(this.hostParticipant?.micMuted) : false,
      effectsLocked: role === "host" ? Boolean(this.hostParticipant?.effectsLocked) : false,
    };
    // sessionToken is kept in the socket's own attachment for this server to
    // recognize a future reconnect -- it must never be broadcast to other
    // participants, unlike the rest of this object.
    const participant = { ...publicParticipant, sessionToken: role === "guest" ? sessionToken : "" };
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment(participant);
    this.ctx.acceptWebSocket(server);
    if (role === "host") {
      this.hostParticipant = publicParticipant;
      this.hostDeadline = null;
      await this.ctx.storage.put("hostParticipant", publicParticipant);
      await this.ctx.storage.delete("hostDeadline");
      await this.ctx.storage.deleteAlarm();
    }
    await this.ctx.storage.put("recentGuests", [...this.recentGuests]);
    this.send(server, "room-state", {
      self: publicParticipant,
      resumed: Boolean(resumingHost || reclaimedId),
      participants: this.participants(),
      sharedUi: this.sharedUi,
      hostReconnectDeadline: this.hostDeadline,
      ...(this.playbackState
        ? { playbackState: this.playbackState.state, playbackSentAt: this.playbackState.sentAt }
        : {}),
    });
    this.broadcast(
      "participant-joined",
      { participant: publicParticipant, resumed: Boolean(resumingHost || reclaimedId) },
      publicParticipant.id,
    );
    if (resumingHost) this.broadcast("host-reconnected", { participant: publicParticipant });
    return new Response(null, { status: 101, webSocket: client });
  }

  // Permission matrix this method enforces (server-side -- the frontend UI
  // hiding a button is a courtesy, not the actual guard):
  //
  // | Action                                    | Host | Guest         |
  // |-------------------------------------------|------|---------------|
  // | play / pause / seek / stop               | yes  | yes           |
  // | return everyone to the library          | yes  | yes           |
  // | tempo/key/radio/search filters (ui state) | yes  | yes           |
  // | own participant audio effects             | yes  | yes           |
  // | own shared library (songs)                | yes  | yes           |
  // | song request/ready and karaoke request    | n/a  | yes           |
  // | mic mute presence                         | yes  | yes           |
  // | signal (WebRTC SDP/ICE relay)              | yes  | yes           |
  // | chat                                       | yes  | yes           |
  //
  // Participant volume is never sent here at all -- it is a purely local
  // per-listener preference (see front/src/contexts/hooks/useOnlineRoomAudio.js)
  // with no room-wide meaning. Kicking a participant is not a feature this
  // product has; there is nothing to authorize.
  async webSocketMessage(socket, rawMessage) {
    await this.ready;
    const text = typeof rawMessage === "string" ? rawMessage : new TextDecoder().decode(rawMessage);
    if (new TextEncoder().encode(text).byteLength > MAX_MESSAGE_BYTES) { this.reject(socket, "Message too large"); return; }
    let message;
    try { message = JSON.parse(text); }
    catch { this.reject(socket); return; }
    const sender = participantFromSocket(socket);
    if (!sender || typeof message?.type !== "string") return;
    if (sender.role === "pending-host") {
      if (message.type !== "host-auth" || typeof message.hostToken !== "string" || sender.authDeadline <= Date.now()) {
        this.reject(socket, "Invalid room host capability");
        return;
      }
      const suppliedToken = message.hostToken;
      let ownerToken = await this.ctx.storage.get("hostToken");
      if (!ownerToken && sender.create && this.participants().length === 0 && suppliedToken.length >= 32 && suppliedToken.length <= 128) {
        ownerToken = suppliedToken;
        await this.ctx.storage.put("hostToken", ownerToken);
      }
      if (!ownerToken || suppliedToken !== ownerToken) {
        this.reject(socket, "Invalid room host capability");
        return;
      }
      if (this.ctx.getWebSockets().some((other) => other !== socket && participantFromSocket(other)?.role === "host")) {
        this.reject(socket, "Host is already connected");
        return;
      }
      const publicParticipant = {
        id: this.hostParticipant?.id || sender.id,
        name: sender.name,
        role: "host",
        micMuted: Boolean(this.hostParticipant?.micMuted),
        effectsLocked: Boolean(this.hostParticipant?.effectsLocked),
      };
      socket.serializeAttachment(publicParticipant);
      this.hostParticipant = publicParticipant;
      const resumed = Boolean(sender.resumingHost);
      this.hostDeadline = null;
      await this.ctx.storage.put("hostParticipant", publicParticipant);
      await this.ctx.storage.delete("hostDeadline");
      await this.ctx.storage.deleteAlarm();
      this.send(socket, "room-state", {
        self: publicParticipant,
        resumed,
        participants: this.participants(),
        sharedUi: this.sharedUi,
        hostReconnectDeadline: null,
        ...(this.playbackState
          ? { playbackState: this.playbackState.state, playbackSentAt: this.playbackState.sentAt }
          : {}),
      });
      this.broadcast("participant-joined", { participant: publicParticipant, resumed }, publicParticipant.id);
      if (resumed) this.broadcast("host-reconnected", { participant: publicParticipant }, publicParticipant.id);
      return;
    }
    if (!this.withinRate(sender.id, sender.role, message.type)) {
      this.send(socket, "error", { code: "rate-limit", message: "Слишком много команд. Повторите действие через несколько секунд." });
      return;
    }

    if (message.type === "ping" && Number.isFinite(message.clientTime)) {
      this.send(socket, "pong", { clientTime: message.clientTime, serverTime: Date.now() });
      return;
    }

    if (message.type === "ice-config-request" && typeof message.requestId === "string" && message.requestId.length <= 128) {
      // This endpoint is reachable only through an admitted room socket. Cache
      // per participant and deduplicate concurrent requests, never broadcast keys.
      const cached = this.iceCredentials.get(sender.id);
      if (cached?.expiresAt > Date.now() + 30_000) {
        const result = await cached.promise;
        this.send(socket, "ice-config", { requestId: message.requestId, ...result });
        return;
      }
      const entry = { expiresAt: Date.now() + 60_000 };
      entry.promise = generateRoomIce(this.env).catch(() => ({
        iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
        relayAvailable: false,
        warning: "Резервный TURN-сервер недоступен. Пробуем прямое соединение.",
        expiresAt: Date.now() + 60_000,
      }));
      this.iceCredentials.set(sender.id, entry);
      const result = await entry.promise;
      entry.expiresAt = result.expiresAt;
      this.send(socket, "ice-config", { requestId: message.requestId, ...result });
      return;
    }

    if (message.type === "signal" && typeof message.targetId === "string") {
      if (new TextEncoder().encode(JSON.stringify(message.signal ?? null)).byteLength > MAX_SIGNAL_BYTES) { this.reject(socket, "Signal too large"); return; }
      const target = this.ctx
        .getWebSockets()
        .find((candidate) => participantFromSocket(candidate)?.id === message.targetId);
      if (target) this.send(target, "signal", { fromId: sender.id, signal: message.signal });
      return;
    }

    if (message.type === "chat" && typeof message.text === "string") {
      const text = message.text.trim().slice(0, 500);
      const { sessionToken: _privateToken, ...publicSender } = sender;
      if (text) this.broadcast("chat", { from: publicSender, text });
      return;
    }

    if (message.type === "effect-permission" && typeof message.locked === "boolean") {
      sender.effectsLocked = message.locked;
      socket.serializeAttachment(sender);
      this.broadcast("participant-updated", {
        participant: {
          id: sender.id,
          name: sender.name,
          role: sender.role,
          micMuted: sender.micMuted,
          effectsLocked: sender.effectsLocked,
        },
      });
      return;
    }

    if (message.type === "effect-control" && typeof message.targetId === "string") {
      const effects = normalizeParticipantEffects(message.effects);
      const target = this.ctx
        .getWebSockets()
        .find((candidate) => participantFromSocket(candidate)?.id === message.targetId);
      const targetParticipant = target && participantFromSocket(target);
      if (!effects || !target || !targetParticipant || targetParticipant.id === sender.id) return;
      if (targetParticipant.effectsLocked) {
        this.send(socket, "effect-control-denied", { targetId: targetParticipant.id });
        return;
      }
      this.send(target, "effect-control", { fromId: sender.id, effects });
      return;
    }

    if (message.type === "ui" && message.state && typeof message.state === "object") {
      if (new TextEncoder().encode(JSON.stringify(message.state)).byteLength > MAX_STATE_BYTES) { this.reportInvalid(socket, "Room UI state is too large"); return; }
      const state = normalizeRoomUi(message.state);
      if (!state) { this.reportInvalid(socket); return; }
      const shared = Object.fromEntries(SHARED_UI_KEYS.filter((key) => Object.hasOwn(state, key)).map((key) => [key, state[key]]));
      if (Object.keys(shared).length) {
        this.sharedUi = { ...this.sharedUi, ...shared };
        await this.ctx.storage?.put?.("sharedUi", this.sharedUi);
      }
      // Echo shared changes too: concurrent edits converge in server order,
      // rather than each sender ignoring the authoritative last update.
      this.broadcast("ui", { fromId: sender.id, state }, Object.keys(shared).length ? null : sender.id);
      return;
    }

    if (message.type === "sync") {
      const state = message.state;
      if (!state || typeof state !== "object" || Array.isArray(state) || new TextEncoder().encode(JSON.stringify(state)).byteLength > MAX_STATE_BYTES) { this.reportInvalid(socket, "Room sync state is invalid or too large"); return; }
      if (state.type === "open-library") {
        // A shared Back button is allowed for every authenticated participant.
        // Replace the saved song command too: reconnect must return to the
        // library instead of resurrecting playback that everyone already left.
        const sentAt = Date.now();
        const libraryState = { type: "open-library" };
        this.playbackState = { state: libraryState, sentAt };
        await this.ctx.storage?.put?.("playbackState", this.playbackState);
        this.broadcast("sync", { state: libraryState, sentAt, fromId: sender.id }, sender.id);
        return;
      }
      if (sender.role === "host") {
        // Remembered so a guest who (re)joins after this was sent -- not
        // live for it, e.g. a brief network drop -- can be caught up via
        // room-state instead of staying on stale playback until the host's
        // next command.
        const sentAt = Date.now();
        if (state.type === "karaoke-player" || state.type === "start-karaoke") {
          this.playbackState = { state, sentAt };
          await this.ctx.storage?.put?.("playbackState", this.playbackState);
        }
        this.broadcast("sync", { state, sentAt, fromId: sender.id }, sender.id);
        return;
      }
      if (
        state.type === "karaoke-player" &&
        ["play", "pause", "stop", "seek", "sync"].includes(state.action) &&
        typeof state.songId === "string" && state.songId.length > 0 && state.songId.length <= 128 &&
        typeof state.commandId === "string" && state.commandId.length > 0 && state.commandId.length <= 128 &&
        Number.isFinite(state.position) && state.position >= 0 && state.position <= 24 * 60 * 60 &&
        (state.executeAt === undefined || (Number.isFinite(state.executeAt) && Math.abs(state.executeAt - Date.now()) <= 10_000))
      ) {
        // Playback controls belong to the shared karaoke console rather than
        // one participant. Relay a validated guest command to the host and all
        // peers, and remember it for reconnecting participants exactly like a
        // host command. Other sync message types remain host-only below.
        const sentAt = Date.now();
        this.playbackState = { state, sentAt };
        await this.ctx.storage?.put?.("playbackState", this.playbackState);
        this.broadcast("sync", { state, sentAt, fromId: sender.id }, sender.id);
        return;
      }
      if (
        (state.type === "song-request" || state.type === "song-ready") &&
        typeof state.songId === "string" && state.songId.length <= 128 &&
        typeof state.commandId === "string" && state.commandId.length <= 128 &&
        typeof state.revision === "string" && /^sha256:[0-9a-f]{64}$/.test(state.revision)
      ) {
        this.broadcast("sync", {
          fromId: sender.id,
          sentAt: Date.now(),
          state: {
            type: state.type,
            songId: state.songId,
            commandId: state.commandId,
            revision: state.revision,
            requesterId: sender.id
          }
        }, sender.id);
        return;
      }
      if (
        state.type === "karaoke-request" &&
        typeof state.songId === "string" && state.songId.length <= 128 &&
        typeof state.ownerId === "string" && state.ownerId.length <= 128 &&
        this.participants().some((participant) => participant.id === state.ownerId) &&
        typeof state.commandId === "string" && state.commandId.length <= 128 &&
        typeof state.revision === "string" && /^sha256:[0-9a-f]{64}$/.test(state.revision)
      ) {
        this.broadcast("sync", {
          fromId: sender.id,
          sentAt: Date.now(),
          state: {
            type: "karaoke-request",
            songId: state.songId,
            ownerId: state.ownerId,
            commandId: state.commandId,
            revision: state.revision,
            requesterId: sender.id
          }
        }, sender.id);
        return;
      }
      this.reject(socket);
      return;
    }

    if (message.type === "presence" && typeof message.micMuted === "boolean") {
      sender.micMuted = message.micMuted;
      socket.serializeAttachment(sender);
      this.broadcast("participant-updated", {
        participant: {
          id: sender.id,
          name: sender.name,
          role: sender.role,
          micMuted: sender.micMuted,
          effectsLocked: Boolean(sender.effectsLocked),
        },
      });
      return;
    }
  }

  async webSocketClose(socket, code, reason) {
    await this.ready;
    const participant = participantFromSocket(socket);
    if (participant) {
      for (const key of this.rate.keys()) if (key.startsWith(`${participant.id}:`)) this.rate.delete(key);
      this.iceCredentials.delete(participant.id);
      if (participant.role === "host") {
        // A late close from the old socket must not evict a reconnected host.
        if (this.ctx.getWebSockets().some((other) => other !== socket && participantFromSocket(other)?.role === "host")) return;
        if (code === 1000 && reason === "Client left room") {
          await this.closeRoom("host-left");
          return;
        }
        const { sessionToken: _token, ...publicHost } = participant;
        this.hostParticipant = publicHost;
        this.hostDeadline = Date.now() + HOST_RECONNECT_GRACE_MS;
        await this.ctx.storage.put("hostParticipant", publicHost);
        await this.ctx.storage.put("hostDeadline", this.hostDeadline);
        await this.ctx.storage.setAlarm(this.hostDeadline);
        this.broadcast("host-reconnecting", { participantId: participant.id, deadline: this.hostDeadline });
      } else if (participant.role === "guest") {
        if (participant.sessionToken) {
          this.recentGuests.set(participant.sessionToken, {
            id: participant.id,
            disconnectedAt: Date.now(),
          });
          pruneRecentGuests(this.recentGuests);
          await this.ctx.storage?.put?.("recentGuests", [...this.recentGuests]);
        }
        this.broadcast("participant-left", { participantId: participant.id });
      }
    }
    // The edge already closes this endpoint before invoking the callback.
    // Calling close() again on THIS socket can prevent the remaining
    // sockets from receiving the broadcasts above.
  }

  async closeRoom(reason) {
    this.broadcast("room-closed", { reason });
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.close(4000, "Host left the room"); } catch { /* Already closed. */ }
    }
    this.hostDeadline = null;
    this.hostParticipant = null;
    this.sharedUi = {};
    this.playbackState = null;
    this.recentGuests.clear();
    this.iceCredentials.clear();
    await this.ctx.storage.delete(["hostToken", "hostParticipant", "hostDeadline", "sharedUi", "playbackState", "recentGuests"]);
    await this.ctx.storage.deleteAlarm();
  }

  async alarm() {
    await this.ready;
    if (!this.hostDeadline) return;
    if (Date.now() < this.hostDeadline) {
      await this.ctx.storage.setAlarm(this.hostDeadline);
      return;
    }
    await this.closeRoom("host-timeout");
  }
}

function sanitizeLogUser(value) {
  const raw = String(value || "anonymous").trim().slice(0, 64);
  const cleaned = raw.replace(/[^\p{L}\p{N} _.-]/gu, "_").trim();
  return cleaned || "anonymous";
}

// Module-scope state survives only while this isolate stays warm, so this is
// a best-effort spam guard, not a hard distributed limit -- the real backstop
// is the per-request size cap below.
const logRate = new Map();
function withinLogRate(id) {
  const now = Date.now();
  const entry = logRate.get(id) || { startedAt: now, count: 0 };
  if (now - entry.startedAt >= LOG_RATE_WINDOW_MS) {
    entry.startedAt = now;
    entry.count = 0;
  }
  entry.count += 1;
  logRate.set(id, entry);
  return entry.count <= LOG_RATE_LIMIT;
}

export async function handleLogUpload(request, env) {
  if (!env.LOGS) return json({ error: "Log storage is not configured" }, 503);
  const clientIp = request.headers.get("cf-connecting-ip") || "unknown";
  if (!withinLogRate(clientIp)) return json({ error: "Rate limit exceeded" }, 429);

  const body = await request.text().catch(() => null);
  if (body === null || new TextEncoder().encode(body).byteLength > MAX_LOG_BYTES) {
    return json({ error: "Invalid or oversized log payload" }, 413);
  }
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const legacyMessage = String(payload?.message || "").trim();
  const events = Array.isArray(payload?.events)
    ? payload.events
        .filter((event) => ["WARNING", "ERROR"].includes(String(event?.level).toUpperCase()))
        .map((event) => ({
          timestamp: String(event?.timestamp || "").slice(0, 40),
          level: String(event?.level || "WARNING").toUpperCase(),
          message: String(event?.message || "").trim().slice(0, 16_000),
        }))
        .filter((event) => event.message)
    : [];
  const hardware = payload?.hardware && typeof payload.hardware === "object" ? payload.hardware : null;
  if (!legacyMessage && !events.length && !hardware) return json({ error: "Empty log batch" }, 400);
  const user = sanitizeLogUser(payload?.device_id || payload?.user);
  const key = `${user}.json`;
  const stored = await env.LOGS.get(key);
  let previous = {};
  if (stored) {
    try {
      previous = JSON.parse(await stored.text());
    } catch {
      previous = {};
    }
  }
  const incomingEvents = legacyMessage
    ? [{ timestamp: new Date().toISOString(), level: "ERROR", message: legacyMessage.slice(0, 16_000) }]
    : events;
  const mergedEvents = [
    ...(Array.isArray(previous.events) ? previous.events : []),
    ...incomingEvents,
  ].slice(-MAX_DEVICE_LOG_EVENTS);
  const document = {
    device_id: String(payload.device_id || previous.device_id || user).slice(0, 80),
    display_name: String(payload.display_name || previous.display_name || "").slice(0, 80),
    updated_at: new Date().toISOString(),
    events: mergedEvents,
    ...((hardware || previous.hardware) ? { hardware: hardware || previous.hardware } : {}),
  };
  try {
    await env.LOGS.put(key, JSON.stringify(document), {
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
      },
    });
  } catch {
    return json({ error: "Log storage write failed; retry later" }, 503);
  }
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health")
      return json({
        ok: true,
        service: "A&D Voice Online",
        turnConfigured: Boolean(env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN),
      });
    if (url.pathname === "/logs" && request.method === "POST") {
      return handleLogUpload(request, env);
    }
    const roomMatch = /^\/rooms\/([^/]+)$/.exec(url.pathname);
    const roomId = roomMatch && normalizeRoomId(roomMatch[1]);
    if (!roomId) return json({ error: "Room not found" }, 404);
    return env.ROOMS.getByName(roomId).fetch(request);
  },
};
