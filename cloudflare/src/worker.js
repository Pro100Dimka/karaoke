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

export class KaraokeRoom {
  constructor(ctx) {
    this.ctx = ctx;
    this.rate = new Map();
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
    const participant = {
      id: crypto.randomUUID(),
      name: normalizeName(url.searchParams.get("name")),
      role,
      micMuted: false,
    };
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment(participant);
    this.ctx.acceptWebSocket(server);
    this.send(server, "room-state", { self: participant, participants: this.participants() });
    this.broadcast("participant-joined", { participant }, participant.id);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, rawMessage) {
    const text = typeof rawMessage === "string" ? rawMessage : new TextDecoder().decode(rawMessage);
    if (new TextEncoder().encode(text).byteLength > MAX_MESSAGE_BYTES) { this.reject(socket, "Message too large"); return; }
    let message;
    try { message = JSON.parse(text); }
    catch { this.reject(socket); return; }
    const sender = participantFromSocket(socket);
    if (!sender || typeof message?.type !== "string") return;
    if (!this.withinRate(sender.id)) { this.reject(socket, "Rate limit exceeded"); return; }

    if (message.type === "signal" && typeof message.targetId === "string") {
      if (
        new TextEncoder().encode(JSON.stringify(message.signal ?? null)).byteLength >
        MAX_SIGNAL_BYTES
      ) {
        this.reject(socket, "Signal too large");
        return;
      }
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
      if (JSON.stringify(message.state).length > MAX_STATE_BYTES) { this.reject(socket); return; }
      if (sender.role === "host") {
        this.broadcast("ui", { fromId: sender.id, state: message.state }, sender.id);
        return;
      }
      const participantEffects = message.state.participantEffects;
      const participantSongs = message.state.participantSongs;
      const hasEffects = participantEffects && typeof participantEffects === "object" && !Array.isArray(participantEffects);
      const hasSongs = Array.isArray(participantSongs) && participantSongs.length <= 500 && participantSongs.every((song) => song && typeof song === "object" && !Array.isArray(song));
      if (!hasEffects && !hasSongs) { this.reject(socket); return; }
      this.broadcast("ui", {
        fromId: sender.id,
        state: {
          ...(hasEffects ? { participantEffects } : {}),
          ...(hasSongs ? { participantSongs } : {}),
        },
      }, sender.id);
      return;
    }

    if (message.type === "sync") {
      const state = message.state;
      if (!state || typeof state !== "object" || Array.isArray(state) || JSON.stringify(state).length > MAX_STATE_BYTES) { this.reject(socket); return; }
      if (sender.role === "host") {
        this.broadcast("sync", { state, sentAt: Date.now(), fromId: sender.id }, sender.id);
        return;
      }
      if (
        state.type === "song-request" &&
        typeof state.songId === "string" && state.songId.length <= 128 &&
        typeof state.commandId === "string" && state.commandId.length <= 128 &&
        typeof state.revision === "string" && /^sha256:[0-9a-f]{64}$/.test(state.revision) &&
        (state.ownerId === undefined || (typeof state.ownerId === "string" && state.ownerId.length <= 128))
      ) {
        this.broadcast("sync", {
          fromId: sender.id,
          sentAt: Date.now(),
          state: {
            type: "song-request",
            songId: state.songId,
            commandId: state.commandId,
            revision: state.revision,
            ...(state.ownerId ? { ownerId: state.ownerId } : {}),
            requesterId: sender.id
          }
        }, sender.id);
        return;
      }
      if (
        state.type === "song-ready" &&
        typeof state.songId === "string" && state.songId.length <= 128 &&
        typeof state.commandId === "string" && state.commandId.length <= 128 &&
        typeof state.revision === "string" && /^sha256:[0-9a-f]{64}$/.test(state.revision)
      ) {
        this.broadcast("sync", {
          fromId: sender.id,
          sentAt: Date.now(),
          state: {
            type: "song-ready",
            songId: state.songId,
            commandId: state.commandId,
            revision: state.revision,
            requesterId: sender.id
          }
        }, sender.id);
        return;
      }
      if (
        state.type === "song-transfer-error" &&
        typeof state.requesterId === "string" && state.requesterId.length <= 128 &&
        typeof state.songId === "string" && state.songId.length <= 128 &&
        typeof state.commandId === "string" && state.commandId.length <= 128 &&
        typeof state.error === "string" && state.error.length <= 500
      ) {
        this.broadcast("sync", {
          fromId: sender.id,
          sentAt: Date.now(),
          state: {
            type: "song-transfer-error",
            requesterId: state.requesterId,
            ownerId: sender.id,
            songId: state.songId,
            commandId: state.commandId,
            error: state.error
          }
        }, sender.id);
        return;
      }
      this.reject(socket);
      return;
    }

    if (message.type === "ping") {
      this.send(socket, "pong", {});
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
    if (participant) { this.rate.delete(participant.id); this.broadcast("participant-left", { participantId: participant.id }); }
    if (this.ctx.getWebSockets().length === 0) await this.ctx.storage.delete("hostToken");
    // The edge already closes this endpoint before invoking the callback.
    // Calling close() again can prevent the remaining sockets from receiving
    // the participant-left event.

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

async function handleLogUpload(request, env) {
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
  const message = String(payload?.message || "").trim();
  if (!message) return json({ error: "Empty log message" }, 400);
  const user = sanitizeLogUser(payload?.user);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `logs/${user}/${timestamp}-${crypto.randomUUID().slice(0, 8)}.log`;
  await env.LOGS.put(key, message.slice(0, MAX_LOG_BYTES), {
    httpMetadata: { contentType: "text/plain; charset=utf-8" },
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
