const DEFAULT_SIGNALING_URL =
  "wss://karaoke-studio-online.pro100dimka-and.workers.dev";

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
        new Error("Код комнаты должен содержать минимум 4 символа."),
      );
    }

    this.disconnect();
    const query = new URLSearchParams({
      name: name?.trim() || "Гость",
      role: host ? "host" : "guest",
    });
    const socket = new WebSocket(`${this.url}/rooms/${normalizedId}?${query}`);
    this.socket = socket;

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        socket.close();
        reject(new Error("Сервер комнат не ответил."));
      }, 10_000);

      socket.onopen = () => {
        window.clearTimeout(timeout);
        resolve(normalizedId);
      };
      socket.onmessage = (event) => {
        try {
          this.emit(JSON.parse(event.data));
        } catch {
          // A malformed packet must not interrupt the room connection.
        }
      };
      socket.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("Не удалось подключиться к комнате."));
      };
      socket.onclose = () => this.emit({ type: "connection-closed" });
    });
  }

  send(type, payload = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type, ...payload }));
    return true;
  }

  disconnect() {
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, "Client left room");
    }
  }
}

export const onlineRoomUrl = DEFAULT_SIGNALING_URL;

// Audio is transferred directly between participants. The Worker is used only
// for signalling, therefore microphone data is never stored in the cloud.
export class OnlineVoiceMesh {
  constructor(roomClient) {
    this.roomClient = roomClient;
    this.peers = new Map();
    this.pendingCandidates = new Map();
    this.pendingInvites = new Set();
    this.channels = new Map();
    this.incomingFiles = new Map();
    this.stream = null;
    this.onRemoteStream = null;
    this.onPeerClosed = null;
    this.onFile = null;
  }

  async start() {
    if (this.stream) return this.stream;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    for (const [participantId, peer] of this.peers) {
      const existingTrackIds = new Set(
        peer.getSenders().map((sender) => sender.track?.id).filter(Boolean),
      );
      this.stream.getTracks().forEach((track) => {
        if (!existingTrackIds.has(track.id)) peer.addTrack(track, this.stream);
      });
      this.pendingInvites.add(participantId);
    }
    const pending = [...this.pendingInvites];
    this.pendingInvites.clear();
    await Promise.allSettled(
      pending.map((participantId) => this.invite(participantId)),
    );
    return this.stream;
  }

  createPeer(participantId) {
    const current = this.peers.get(participantId);
    if (current) return current;

    const peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }],
    });
    this.stream?.getTracks().forEach((track) => {
      peer.addTrack(track, this.stream);
    });
    peer.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.roomClient.send("signal", {
          targetId: participantId,
          signal: { candidate },
        });
      }
    };
    peer.ontrack = ({ streams }) => {
      if (streams[0]) this.onRemoteStream?.(participantId, streams[0]);
    };
    peer.ondatachannel = ({ channel }) => this.setupDataChannel(participantId, channel);
    peer.onconnectionstatechange = () => {
      if (!["failed", "closed"].includes(peer.connectionState)) return;
      this.removePeer(participantId);
    };
    this.peers.set(participantId, peer);
    return peer;
  }

  async invite(participantId) {
    if (!participantId) return;
    const peer = this.createPeer(participantId);
    if (!this.channels.has(participantId)) {
      this.setupDataChannel(
        participantId,
        peer.createDataChannel("karaoke-library", { ordered: true }),
      );
    }
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    this.roomClient.send("signal", {
      targetId: participantId,
      signal: { description: peer.localDescription },
    });
  }

  async accept(fromId, signal) {
    const peer = this.createPeer(fromId);
    if (signal?.candidate) {
      if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate);
      else {
        const queue = this.pendingCandidates.get(fromId) || [];
        queue.push(signal.candidate);
        this.pendingCandidates.set(fromId, queue);
      }
      return;
    }
    if (!signal?.description) return;

    await peer.setRemoteDescription(signal.description);
    const candidates = this.pendingCandidates.get(fromId) || [];
    this.pendingCandidates.delete(fromId);
    for (const candidate of candidates) await peer.addIceCandidate(candidate);

    if (signal.description.type === "offer") {
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      this.roomClient.send("signal", {
        targetId: fromId,
        signal: { description: peer.localDescription },
      });
    }
  }

  setMicrophoneMuted(muted) {
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  setupDataChannel(participantId, channel) {
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 256 * 1024;
    channel.onmessage = ({ data }) => {
      if (typeof data === "string") {
        let message;
        try {
          message = JSON.parse(data);
        } catch {
          return;
        }
        if (message.type === "file-start") {
          this.incomingFiles.set(participantId, { metadata: message, chunks: [], received: 0 });
        } else if (message.type === "file-end") {
          const transfer = this.incomingFiles.get(participantId);
          this.incomingFiles.delete(participantId);
          if (!transfer || transfer.metadata.transferId !== message.transferId) return;
          const blob = new Blob(transfer.chunks, { type: transfer.metadata.mimeType });
          this.onFile?.(participantId, blob, transfer.metadata);
        }
        return;
      }
      const transfer = this.incomingFiles.get(participantId);
      if (!transfer) return;
      const chunk = data instanceof ArrayBuffer ? data : data.buffer;
      transfer.chunks.push(chunk);
      transfer.received += chunk.byteLength;
      if (transfer.received > transfer.metadata.size) {
        this.incomingFiles.delete(participantId);
      }
    };
    channel.onclose = () => {
      if (this.channels.get(participantId) === channel) this.channels.delete(participantId);
    };
    this.channels.set(participantId, channel);
  }

  async waitForDataChannel(participantId, timeoutMs = 15_000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const channel = this.channels.get(participantId);
      if (channel?.readyState === "open") return channel;
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    throw new Error("Канал передачи песни не готов");
  }

  async sendFile(participantId, blob, metadata = {}) {
    const channel = await this.waitForDataChannel(participantId);
    const transferId = crypto.randomUUID();
    channel.send(JSON.stringify({
      type: "file-start",
      transferId,
      size: blob.size,
      mimeType: blob.type || "application/octet-stream",
      ...metadata,
    }));
    const chunkSize = 32 * 1024;
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      while (channel.bufferedAmount > 512 * 1024) {
        await new Promise((resolve) => window.setTimeout(resolve, 20));
      }
      channel.send(await blob.slice(offset, offset + chunkSize).arrayBuffer());
    }
    channel.send(JSON.stringify({ type: "file-end", transferId }));
  }

  removePeer(participantId) {
    this.peers.get(participantId)?.close();
    this.peers.delete(participantId);
    this.pendingCandidates.delete(participantId);
    this.pendingInvites.delete(participantId);
    this.channels.get(participantId)?.close();
    this.channels.delete(participantId);
    this.incomingFiles.delete(participantId);
    this.onPeerClosed?.(participantId);
  }

  stop() {
    [...this.peers.keys()].forEach((id) => this.removePeer(id));
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.pendingInvites.clear();
  }
}
