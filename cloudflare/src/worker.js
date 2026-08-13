const MAX_ROOM_ID_LENGTH = 32;
const MAX_NAME_LENGTH = 40;

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
    const hasHost = currentParticipants.some((participant) => participant.role === "host");
    const participant = {
      id: crypto.randomUUID(),
      name: normalizeName(url.searchParams.get("name")),
      role:
        currentParticipants.length === 0 || (requestedRole === "host" && !hasHost)
          ? "host"
          : "guest",
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
    let message;
    try {
      message = JSON.parse(typeof rawMessage === "string" ? rawMessage : new TextDecoder().decode(rawMessage));
    } catch {
      this.send(socket, "error", { message: "Некорректное сообщение комнаты." });
      return;
    }
    const sender = participantFromSocket(socket);
    if (!sender || typeof message?.type !== "string") return;

    if (message.type === "signal" && typeof message.targetId === "string") {
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
      this.broadcast("ui", { fromId: sender.id, state: message.state }, sender.id);
      return;
    }

    if (message.type === "sync") {
      this.broadcast("sync", { state: message.state, sentAt: Date.now() }, sender.id);
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

    if (message.type === "claim-host" && !this.participants().some((participant) => participant.role === "host")) {
      sender.role = "host";
      socket.serializeAttachment(sender);
      this.broadcast("room-state", { self: null, participants: this.participants() });
    }
  }

  async webSocketClose(socket, code, reason) {
    const participant = participantFromSocket(socket);
    if (participant) this.broadcast("participant-left", { participantId: participant.id });
    // The edge already closes this endpoint before invoking the callback.
    // Calling close() again can prevent the remaining sockets from receiving
    // the participant-left event.
    if (participant?.role === "host") {
      const successorSocket = this.ctx.getWebSockets().find((candidate) => {
        const candidateParticipant = participantFromSocket(candidate);
        return candidateParticipant && candidateParticipant.id !== participant.id;
      });
      if (successorSocket) {
        const successor = participantFromSocket(successorSocket);
        successor.role = "host";
        successorSocket.serializeAttachment(successor);
        this.send(successorSocket, "self-updated", { self: successor });
        this.broadcast("participant-updated", { participant: successor });
      }
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, service: "A&D Voice Online" });
    const roomMatch = /^\/rooms\/([^/]+)$/.exec(url.pathname);
    const roomId = roomMatch && normalizeRoomId(roomMatch[1]);
    if (!roomId) return json({ error: "Room not found" }, 404);
    return env.ROOMS.getByName(roomId).fetch(request);
  },
};
