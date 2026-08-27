const MAX_ROOM_ID_LENGTH = 32;
const MAX_NAME_LENGTH = 40;
const MAX_MESSAGE_BYTES = 256 * 1024;
const MAX_PARTICIPANTS = 12;
const RATE_WINDOW_MS = 10_000;
const RATE_LIMIT = 80;
const MAX_SIGNAL_BYTES = 64 * 1024;
const MAX_STATE_BYTES = 128 * 1024;
const MAX_LOG_BYTES = 32 * 1024;
const LOG_RATE_WINDOW_MS = 60_000;
const LOG_RATE_LIMIT = 30;
const MAX_ROOM_SONGS = 500;
// How long a guest's participant id (and therefore their volume/mute/effect
// settings in every other client's UI, which are keyed by that id) is held
// for them to reclaim on a reconnect -- a brief network drop shouldn't make
// them look like a brand new person to everyone else. The host has no such
// grace period: per the chosen host-lifecycle contract, the room closes the
// moment the host disconnects (see webSocketClose), so there is nothing to
// reclaim.
const GUEST_RECONNECT_GRACE_MS = 45_000;
// Bumped only when the message schema itself changes incompatibly (a field
// renamed/removed/retyped in a message the other side must understand) --
// not on every worker/frontend release. Without this, an old frontend build
// talking to a newer worker (or vice versa) after such a change would just
// silently drop/misinterpret messages instead of failing the connection with
// an explicit reason.
export const ROOM_PROTOCOL_VERSION = 1;

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
  constructor(ctx) {
    this.ctx = ctx;
    this.rate = new Map();
    this.recentGuests = new Map();
    this.playbackState = null;
  }

  reject(socket, message = "Некорректное сообщение комнаты.") {
    this.send(socket, "error", { message });
    socket.close(1008, message.slice(0, 120));
  }

  withinRate(id) {
    const now = Date.now();
    const entry = this.rate.get(id) || { startedAt: now, count: 0 };
    if (now - entry.startedAt >= RATE_WINDOW_MS) { entry.startedAt = now; entry.count = 0; }
    entry.count += 1; this.rate.set(id, entry);
    return entry.count <= RATE_LIMIT;
  }

  participants() {
    return this.ctx
      .getWebSockets()
      .map(participantFromSocket)
      .filter(Boolean)
      .map(({ id, name, role, micMuted = false }) => ({
        id,
        name,
        role,
        micMuted,
      }));
  }

  send(socket, type, payload) {
    socket.send(JSON.stringify({ type, ...payload }));
  }

  broadcast(type, payload, exceptId = null) {
    for (const socket of this.ctx.getWebSockets()) {
      const participant = participantFromSocket(socket);
      if (!participant || participant.id === exceptId) continue;
      this.send(socket, type, payload);
    }
  }

  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "WebSocket upgrade required" }, 426);
    }
    const url = new URL(request.url);
    const clientVersion = Number.parseInt(url.searchParams.get("v") || "", 10);
    if (clientVersion !== ROOM_PROTOCOL_VERSION) {
      return json({ error: "Unsupported room protocol version", expected: ROOM_PROTOCOL_VERSION }, 400);
    }
    const requestedRole = url.searchParams.get("role") === "host" ? "host" : "guest";
    const currentParticipants = this.participants();
    if (currentParticipants.length >= MAX_PARTICIPANTS) return json({ error: "Room is full" }, 429);
    let role = "guest";
    if (requestedRole === "host") {
      const suppliedToken = url.searchParams.get("hostToken") || "";
      let ownerToken = await this.ctx.storage.get("hostToken");
      if (!ownerToken && url.searchParams.get("create") === "1" && currentParticipants.length === 0 && suppliedToken.length >= 32) {
        ownerToken = suppliedToken;
        await this.ctx.storage.put("hostToken", ownerToken);
      }
      if (!ownerToken || suppliedToken !== ownerToken) return json({ error: "Invalid room host capability" }, 403);
      if (currentParticipants.some((participant) => participant.role === "host")) return json({ error: "Host is already connected" }, 409);
      role = "host";
    }
    // A guest that reconnects within the grace window (see
    // GUEST_RECONNECT_GRACE_MS) reclaims their previous id instead of
    // getting a fresh one, so the volume/mute/effect settings every other
    // client already has recorded for that id keep applying -- otherwise
    // reconnecting looked exactly like a brand new person joining.
    const sessionToken = String(url.searchParams.get("sessionId") || "").slice(0, 128);
    const reclaimedId = role === "guest" ? reclaimGuestId(this.recentGuests, sessionToken) : null;
    const publicParticipant = {
      id: reclaimedId || crypto.randomUUID(),
      name: normalizeName(url.searchParams.get("name")),
      role,
      micMuted: false,
    };
    // sessionToken is kept in the socket's own attachment for this server to
    // recognize a future reconnect -- it must never be broadcast to other
    // participants, unlike the rest of this object.
    const participant = { ...publicParticipant, sessionToken: role === "guest" ? sessionToken : "" };
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment(participant);
    this.ctx.acceptWebSocket(server);
    this.send(server, "room-state", {
      self: publicParticipant,
      participants: this.participants(),
      ...(this.playbackState
        ? { playbackState: this.playbackState.state, playbackSentAt: this.playbackState.sentAt }
        : {}),
    });
    this.broadcast("participant-joined", { participant: publicParticipant }, publicParticipant.id);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Permission matrix this method enforces (server-side -- the frontend UI
  // hiding a button is a courtesy, not the actual guard):
  //
  // | Action                                    | Host | Guest         |
  // |-------------------------------------------|------|---------------|
  // | select song / play / pause / seek         | yes  | no (rejected) |
  // | tempo/key/radio/search filters (ui state) | yes  | no (rejected) |
  // | own participant audio effects             | yes  | yes           |
  // | own shared library (songs)                | yes  | yes           |
  // | song-request / song-ready handshake       | n/a  | yes           |
  // | mic mute presence                         | yes  | yes           |
  // | signal (WebRTC SDP/ICE relay)              | yes  | yes           |
  // | chat                                       | yes  | yes           |
  //
  // Participant volume is never sent here at all -- it is a purely local
  // per-listener preference (see front/src/contexts/hooks/useOnlineRoomAudio.js)
  // with no room-wide meaning. Kicking a participant is not a feature this
  // product has; there is nothing to authorize.
  async webSocketMessage(socket, rawMessage) {
    const text = typeof rawMessage === "string" ? rawMessage : new TextDecoder().decode(rawMessage);
    if (new TextEncoder().encode(text).byteLength > MAX_MESSAGE_BYTES) { this.reject(socket, "Message too large"); return; }
    let message;
    try { message = JSON.parse(text); }
    catch { this.reject(socket); return; }
    const sender = participantFromSocket(socket);
    if (!sender || typeof message?.type !== "string") return;
    if (!this.withinRate(sender.id)) { this.reject(socket, "Rate limit exceeded"); return; }

    if (message.type === "ping" && Number.isFinite(message.clientTime)) {
      this.send(socket, "pong", { clientTime: message.clientTime, serverTime: Date.now() });
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
      if (text) this.broadcast("chat", { from: sender, text });
      return;
    }

    if (message.type === "ui" && message.state && typeof message.state === "object") {
      if (new TextEncoder().encode(JSON.stringify(message.state)).byteLength > MAX_STATE_BYTES) { this.reject(socket); return; }
      if (sender.role === "host") {
        this.broadcast("ui", { fromId: sender.id, state: message.state }, sender.id);
        return;
      }
      // Guests may not broadcast arbitrary state (that stays host-only, e.g. the
      // shared search query), but every participant -- host or guest -- owns a
      // library, so both participantEffects and songs are allowed through here.
      const { participantEffects, songs } = message.state;
      const hasEffects = Boolean(
        participantEffects && typeof participantEffects === "object" && !Array.isArray(participantEffects)
      );
      const hasSongs = Boolean(
        Array.isArray(songs) &&
        songs.length <= MAX_ROOM_SONGS &&
        songs.every((song) => song && typeof song === "object" && !Array.isArray(song))
      );
      if (!hasEffects && !hasSongs) { this.reject(socket); return; }
      const state = {
        ...(hasEffects ? { participantEffects } : {}),
        ...(hasSongs ? { songs } : {})
      };
      this.broadcast("ui", { fromId: sender.id, state }, sender.id);
      return;
    }

    if (message.type === "sync") {
      const state = message.state;
      if (!state || typeof state !== "object" || Array.isArray(state) || new TextEncoder().encode(JSON.stringify(state)).byteLength > MAX_STATE_BYTES) { this.reject(socket); return; }
      if (sender.role === "host") {
        // Remembered so a guest who (re)joins after this was sent -- not
        // live for it, e.g. a brief network drop -- can be caught up via
        // room-state instead of staying on stale playback until the host's
        // next command.
        const sentAt = Date.now();
        if (state.type === "karaoke-player") this.playbackState = { state, sentAt };
        this.broadcast("sync", { state, sentAt, fromId: sender.id }, sender.id);
        return;
      }
      if (
        state.type === "song-request" &&
        typeof state.songId === "string" && state.songId.length <= 128 &&
        typeof state.commandId === "string" && state.commandId.length <= 128 &&
        typeof state.revision === "string" && /^sha256:[0-9a-f]{64}$/.test(state.revision)
      ) {
        this.broadcast("sync", {
          fromId: sender.id,
          sentAt: Date.now(),
          state: {
            type: "song-request",
            songId: state.songId,
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
        },
      });
      return;
    }
  }

  async webSocketClose(socket, code, reason) {
    const participant = participantFromSocket(socket);
    if (participant) {
      this.rate.delete(participant.id);
      if (participant.role === "host") {
        // The room closes the moment its host leaves rather than persisting
        // in an undefined "headless" state (no re-election, no host-only
        // sync) until/unless the same host token reconnects. Every
        // remaining guest gets an explicit reason as a message first (so it
        // arrives ahead of the close frame on the same socket), then their
        // connection is closed server-side so their own disconnect/cleanup
        // path runs immediately instead of sitting in a hostless room.
        this.broadcast("room-closed", { reason: "host-left" });
        for (const remaining of this.ctx.getWebSockets()) {
          try {
            remaining.close(4000, "Host left the room");
          } catch {
            // Already closing/closed.
          }
        }
        await this.ctx.storage.delete("hostToken");
      } else {
        if (participant.sessionToken) {
          this.recentGuests.set(participant.sessionToken, {
            id: participant.id,
            disconnectedAt: Date.now(),
          });
        }
        this.broadcast("participant-left", { participantId: participant.id });
      }
    }
    // The edge already closes this endpoint before invoking the callback.
    // Calling close() again on THIS socket can prevent the remaining
    // sockets from receiving the broadcasts above.
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
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const batch = legacyMessage
    ? legacyMessage.slice(0, MAX_LOG_BYTES)
    : JSON.stringify({
        device_id: String(payload.device_id || "").slice(0, 80),
        display_name: String(payload.display_name || "").slice(0, 80),
        events,
        ...(hardware ? { hardware } : {}),
      });
  const extension = legacyMessage ? "log" : "json";
  const key = `${user}/${timestamp}-${crypto.randomUUID().slice(0, 8)}.${extension}`;
  await env.LOGS.put(key, batch, {
    httpMetadata: {
      contentType: legacyMessage ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    },
  });
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, service: "A&D Voice Online" });
    if (url.pathname === "/logs" && request.method === "POST") {
      return handleLogUpload(request, env);
    }
    const roomMatch = /^\/rooms\/([^/]+)$/.exec(url.pathname);
    const roomId = roomMatch && normalizeRoomId(roomMatch[1]);
    if (!roomId) return json({ error: "Room not found" }, 404);
    return env.ROOMS.getByName(roomId).fetch(request);
  },
};
