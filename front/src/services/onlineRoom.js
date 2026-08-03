const DEFAULT_SIGNALING_URL =
  "wss://karaoke-studio-online.pro100dimka-and.workers.dev";

function roomId(value) {
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
    const normalizedId = roomId(id);
    if (normalizedId.length < 4) {
      return Promise.reject(new Error("Код комнаты должен содержать минимум 4 символа."));
    }
    this.disconnect();
    const query = new URLSearchParams({ name: name?.trim() || "Гость", role: host ? "host" : "guest" });
    const socket = new WebSocket(`${this.url}/rooms/${normalizedId}?${query}`);
    this.socket = socket;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Сервер комнат не ответил.")), 10_000);
      socket.onopen = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      socket.onmessage = (event) => {
        try {
          this.emit(JSON.parse(event.data));
        } catch {
          // Ignore malformed network traffic.
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
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type, ...payload }));
    }
  }

  disconnect() {
    this.socket?.close(1000, "Client left room");
    this.socket = null;
  }
}

export const onlineRoomUrl = DEFAULT_SIGNALING_URL;

// Peer-to-peer voice transport. Signalling stays in the room Worker; audio
// itself never passes through the Worker or permanent cloud storage.
export class OnlineVoiceMesh {
  constructor(roomClient) {
    this.roomClient = roomClient;
    this.peers = new Map();
    this.stream = null;
    this.onRemoteStream = null;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    return this.stream;
  }

  createPeer(participantId) {
    if (this.peers.has(participantId)) return this.peers.get(participantId);
    const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] });
    this.stream?.getTracks().forEach((track) => peer.addTrack(track, this.stream));
    peer.onicecandidate = ({ candidate }) => {
      if (candidate) this.roomClient.send("signal", { targetId: participantId, signal: { candidate } });
    };
    peer.ontrack = ({ streams }) => this.onRemoteStream?.(participantId, streams[0]);
    peer.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(peer.connectionState)) this.peers.delete(participantId);
    };
    this.peers.set(participantId, peer);
    return peer;
  }

  async invite(participantId) {
    const peer = this.createPeer(participantId);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    this.roomClient.send("signal", { targetId: participantId, signal: { description: peer.localDescription } });
  }

  async accept(fromId, signal) {
    const peer = this.createPeer(fromId);
    if (signal.candidate) return peer.addIceCandidate(signal.candidate);
    if (!signal.description) return undefined;
    await peer.setRemoteDescription(signal.description);
    if (signal.description.type === "offer") {
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      this.roomClient.send("signal", { targetId: fromId, signal: { description: peer.localDescription } });
    }
    return undefined;
  }

  stop() {
    this.peers.forEach((peer) => peer.close());
    this.peers.clear();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
