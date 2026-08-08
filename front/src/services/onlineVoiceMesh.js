// Audio is transferred directly between participants. The Worker is used only
// for signalling, therefore microphone data is never stored in the cloud.

const wait = (delayMs) =>
  new Promise((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });

const getBinaryChunk = (data) => {
  if (data instanceof ArrayBuffer) return data;
  if (!ArrayBuffer.isView(data)) return null;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
};

const MAX_INCOMING_FILE_BYTES = 512 * 1024 * 1024;
const MAX_TRANSFER_ID_LENGTH = 128;
const MAX_FILENAME_LENGTH = 512;
const MAX_PENDING_ICE_CANDIDATES = 256;
const MAX_INCOMING_CHUNKS = 32_768;
const MAX_DATA_MESSAGE_LENGTH = 16 * 1024;
const isValidTransferSize = (size) =>
  Number.isSafeInteger(size) && size >= 0 && size <= MAX_INCOMING_FILE_BYTES;
export default class OnlineVoiceMesh {
  constructor(roomClient) {
    this.roomClient = roomClient;
    this.peers = new Map();
    this.pendingCandidates = new Map();
    this.pendingInvites = new Set();
    this.invitePromises = new Map();
    this.signalPromises = new Map();
    this.peerVersions = new Map();
    this.channels = new Map();
    this.incomingFiles = new Map();
    this.stream = null;
    this.startPromise = null;
    this.lifecycleVersion = 0;
    this.onRemoteStream = null;
    this.onPeerClosed = null;
    this.onFile = null;
    this.disconnectTimers = new Map();
  }

  async start() {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      throw new Error("Захват микрофона не поддерживается в этом окружении");
    }

    const liveStream = this.stream
      ?.getAudioTracks?.()
      .some((track) => track.readyState === "live");
    if (liveStream) return this.stream;
    if (this.stream) {
      this.stream.getTracks?.().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.startPromise) return this.startPromise;

    const { lifecycleVersion } = this;
    const startPromise = navigator.mediaDevices
      .getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      })
      .then(async (stream) => {
        if (lifecycleVersion !== this.lifecycleVersion) {
          stream.getTracks().forEach((track) => track.stop());
          throw new Error("Запуск микрофона отменён");
        }

        this.stream = stream;
        for (const [participantId, peer] of this.peers) {
          const existingTrackIds = new Set(
            peer
              .getSenders()
              .map((sender) => sender.track?.id)
              .filter(Boolean)
          );
          stream.getTracks().forEach((track) => {
            if (!existingTrackIds.has(track.id)) peer.addTrack(track, stream);
          });
          this.pendingInvites.add(participantId);
        }
        const pending = [...this.pendingInvites];
        this.pendingInvites.clear();
        await Promise.allSettled(
          pending.map((participantId) => this.invite(participantId))
        );
        return stream;
      })
      .finally(() => {
        if (this.startPromise === startPromise) this.startPromise = null;
      });

    this.startPromise = startPromise;
    return startPromise;
  }

  createPeer(participantId) {
    if (
      typeof participantId !== "string" ||
      !participantId ||
      participantId.length > 128
    ) {
      throw new TypeError("Некорректный идентификатор участника");
    }
    if (typeof globalThis.RTCPeerConnection !== "function") {
      throw new Error("WebRTC не поддерживается в этом окружении");
    }

    const current = this.peers.get(participantId);
    if (current) return current;

    const peer = new globalThis.RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }]
    });
    this.stream?.getTracks().forEach((track) => {
      peer.addTrack(track, this.stream);
    });
    const isCurrentPeer = () => this.peers.get(participantId) === peer;
    peer.onicecandidate = ({ candidate }) => {
      if (!candidate || !isCurrentPeer()) return;
      this.roomClient.send("signal", {
        targetId: participantId,
        signal: { candidate }
      });
    };
    peer.ontrack = ({ streams }) => {
      const stream = streams[0];
      if (!stream) return;
      if (!isCurrentPeer()) {
        stream.getTracks?.().forEach((track) => track.stop());
        return;
      }
      this.onRemoteStream?.(participantId, stream);
    };
    peer.ondatachannel = ({ channel }) => {
      if (!isCurrentPeer()) {
        channel.close?.();
        return;
      }
      this.setupDataChannel(participantId, channel);
    };
    peer.onconnectionstatechange = () => {
      if (!isCurrentPeer()) return;
      const previousTimer = this.disconnectTimers.get(participantId);
      if (previousTimer) {
        globalThis.clearTimeout(previousTimer);
        this.disconnectTimers.delete(participantId);
      }
      if (["failed", "closed"].includes(peer.connectionState)) {
        this.removePeer(participantId);
        return;
      }
      if (peer.connectionState === "disconnected") {
        const timer = globalThis.setTimeout(() => {
          this.disconnectTimers.delete(participantId);
          if (isCurrentPeer() && peer.connectionState === "disconnected") {
            this.removePeer(participantId);
          }
        }, 10_000);
        this.disconnectTimers.set(participantId, timer);
      }
    };
    this.peers.set(participantId, peer);
    return peer;
  }

  async invite(participantId) {
    if (!participantId) return false;

    const pendingInvite = this.invitePromises.get(participantId);
    if (pendingInvite) return pendingInvite;

    const { lifecycleVersion } = this;
    const peer = this.createPeer(participantId);
    const isCurrentPeer = () =>
      lifecycleVersion === this.lifecycleVersion &&
      this.peers.get(participantId) === peer &&
      peer.connectionState !== "closed";

    const invitePromise = (async () => {
      if (!this.channels.has(participantId)) {
        this.setupDataChannel(
          participantId,
          peer.createDataChannel("karaoke-library", { ordered: true })
        );
      }

      try {
        const offer = await peer.createOffer();
        if (!isCurrentPeer()) return false;

        await peer.setLocalDescription(offer);
        if (!isCurrentPeer() || !peer.localDescription) return false;

        return this.roomClient.send("signal", {
          targetId: participantId,
          signal: { description: peer.localDescription }
        });
      } catch (error) {
        if (!isCurrentPeer()) return false;
        throw error;
      }
    })().finally(() => {
      if (this.invitePromises.get(participantId) === invitePromise) {
        this.invitePromises.delete(participantId);
      }
    });

    this.invitePromises.set(participantId, invitePromise);
    return invitePromise;
  }

  async accept(fromId, signal) {
    if (
      typeof fromId !== "string" ||
      !fromId ||
      fromId.length > 128 ||
      !signal ||
      typeof signal !== "object" ||
      Array.isArray(signal)
    ) {
      return false;
    }

    const peerVersion = this.peerVersions.get(fromId) || 0;
    const previousSignal = this.signalPromises.get(fromId) || Promise.resolve();
    const signalPromise = previousSignal
      .catch(() => {})
      .then(async () => {
        if ((this.peerVersions.get(fromId) || 0) !== peerVersion) return false;
        const { lifecycleVersion } = this;
        const peer = this.createPeer(fromId);
        const isCurrentPeer = () =>
          lifecycleVersion === this.lifecycleVersion &&
          (this.peerVersions.get(fromId) || 0) === peerVersion &&
          this.peers.get(fromId) === peer &&
          peer.connectionState !== "closed";

        if (signal.candidate) {
          if (!isCurrentPeer()) return false;
          if (peer.remoteDescription) {
            await peer.addIceCandidate(signal.candidate);
            return isCurrentPeer();
          }
          const queue = this.pendingCandidates.get(fromId) || [];
          if (queue.length >= MAX_PENDING_ICE_CANDIDATES) {
            this.removePeer(fromId);
            throw new Error("Получено слишком много ICE-кандидатов");
          }
          queue.push(signal.candidate);
          this.pendingCandidates.set(fromId, queue);
          return true;
        }
        if (!signal.description) return false;

        await peer.setRemoteDescription(signal.description);
        if (!isCurrentPeer()) return false;

        const candidates = this.pendingCandidates.get(fromId) || [];
        this.pendingCandidates.delete(fromId);
        // ICE candidates must be applied in arrival order.
        // eslint-disable-next-line no-restricted-syntax
        for (const candidate of candidates) {
          if (!isCurrentPeer()) return false;
          // eslint-disable-next-line no-await-in-loop
          await peer.addIceCandidate(candidate);
        }

        if (signal.description.type !== "offer") return true;

        const answer = await peer.createAnswer();
        if (!isCurrentPeer()) return false;
        await peer.setLocalDescription(answer);
        if (!isCurrentPeer() || !peer.localDescription) return false;

        return this.roomClient.send("signal", {
          targetId: fromId,
          signal: { description: peer.localDescription }
        });
      })
      .finally(() => {
        if (this.signalPromises.get(fromId) === signalPromise) {
          this.signalPromises.delete(fromId);
        }
      });

    this.signalPromises.set(fromId, signalPromise);
    return signalPromise;
  }

  setMicrophoneMuted(muted) {
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  setupDataChannel(participantId, channel) {
    const previousChannel = this.channels.get(participantId);
    if (previousChannel && previousChannel !== channel) {
      this.incomingFiles.delete(participantId);
      if (previousChannel.readyState !== "closed") previousChannel.close?.();
    }

    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 256 * 1024;
    channel.onmessage = ({ data }) => {
      if (typeof data === "string") {
        if (data.length > MAX_DATA_MESSAGE_LENGTH) return;
        let message;
        try {
          message = JSON.parse(data);
        } catch {
          return;
        }
        if (!message || typeof message !== "object" || Array.isArray(message)) {
          return;
        }
        if (message.type === "file-start") {
          if (this.incomingFiles.has(participantId)) return;
          const transferId =
            typeof message.transferId === "string" ? message.transferId : "";
          if (
            !transferId ||
            transferId.length > MAX_TRANSFER_ID_LENGTH ||
            !isValidTransferSize(message.size)
          ) {
            this.incomingFiles.delete(participantId);
            return;
          }
          const metadata = {
            type: "file-start",
            kind:
              typeof message.kind === "string"
                ? message.kind.slice(0, 64)
                : undefined,
            songId:
              typeof message.songId === "string"
                ? message.songId.slice(0, 128)
                : undefined,
            size: message.size,
            transferId,
            filename:
              typeof message.filename === "string"
                ? message.filename.slice(0, MAX_FILENAME_LENGTH)
                : undefined,
            mimeType:
              typeof message.mimeType === "string"
                ? message.mimeType.slice(0, 255)
                : "application/octet-stream"
          };
          this.incomingFiles.set(participantId, {
            metadata,
            chunks: [],
            received: 0
          });
        } else if (message.type === "file-end") {
          const transfer = this.incomingFiles.get(participantId);
          this.incomingFiles.delete(participantId);
          if (
            !transfer ||
            transfer.metadata.transferId !== message.transferId ||
            transfer.received !== transfer.metadata.size
          ) {
            return;
          }
          const BlobClass = globalThis.Blob;
          if (typeof BlobClass !== "function") return;
          const blob = new BlobClass(transfer.chunks, {
            type: transfer.metadata.mimeType
          });
          Promise.resolve(
            this.onFile?.(participantId, blob, transfer.metadata)
          ).catch(() => {});
        }
        return;
      }
      const transfer = this.incomingFiles.get(participantId);
      const chunk = getBinaryChunk(data);
      if (!transfer || !chunk || chunk.byteLength === 0) return;
      if (transfer.chunks.length >= MAX_INCOMING_CHUNKS) {
        this.incomingFiles.delete(participantId);
        return;
      }
      transfer.received += chunk.byteLength;
      if (transfer.received > transfer.metadata.size) {
        this.incomingFiles.delete(participantId);
        return;
      }
      transfer.chunks.push(chunk);
    };
    const clearChannel = () => {
      if (this.channels.get(participantId) !== channel) return;
      this.channels.delete(participantId);
      this.incomingFiles.delete(participantId);
    };
    channel.onclose = clearChannel;
    channel.onerror = clearChannel;
    this.channels.set(participantId, channel);
  }

  async waitForDataChannel(
    participantId,
    timeoutMs = 15_000,
    lifecycleVersion = this.lifecycleVersion
  ) {
    const safeTimeout = Number.isFinite(Number(timeoutMs))
      ? Math.max(0, Math.min(60_000, Number(timeoutMs)))
      : 15_000;
    const startedAt = Date.now();
    while (Date.now() - startedAt < safeTimeout) {
      if (lifecycleVersion !== this.lifecycleVersion) {
        throw new Error("Передача файла отменена");
      }
      const channel = this.channels.get(participantId);
      if (channel?.readyState === "open") return channel;
      if (
        channel?.readyState === "closing" ||
        channel?.readyState === "closed"
      ) {
        throw new Error("Канал передачи песни закрыт");
      }
      // Polling is intentionally sequential.
      // eslint-disable-next-line no-await-in-loop
      await wait(50);
    }
    throw new Error("Канал передачи песни не готов");
  }

  async sendFile(participantId, blob, metadata = {}) {
    const BlobClass = globalThis.Blob;
    if (
      typeof participantId !== "string" ||
      !participantId ||
      participantId.length > 128 ||
      typeof BlobClass !== "function" ||
      !(blob instanceof BlobClass)
    ) {
      throw new TypeError("Для передачи нужны участник и файл");
    }
    if (blob.size > MAX_INCOMING_FILE_BYTES) {
      throw new RangeError("Файл слишком большой для передачи через комнату");
    }
    const { lifecycleVersion } = this;
    const channel = await this.waitForDataChannel(
      participantId,
      15_000,
      lifecycleVersion
    );
    const transferId =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    if (channel.readyState !== "open") {
      throw new Error("Канал передачи песни закрыт");
    }
    channel.send(
      JSON.stringify({
        type: "file-start",
        transferId,
        size: blob.size,
        kind:
          typeof metadata?.kind === "string"
            ? metadata.kind.slice(0, 64)
            : undefined,
        songId:
          typeof metadata?.songId === "string"
            ? metadata.songId.slice(0, 128)
            : undefined,
        filename:
          typeof metadata?.filename === "string"
            ? metadata.filename.slice(0, MAX_FILENAME_LENGTH)
            : undefined,
        mimeType: (blob.type || "application/octet-stream").slice(0, 255)
      })
    );
    const chunkSize = 32 * 1024;
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      while (channel.bufferedAmount > 512 * 1024) {
        if (
          lifecycleVersion !== this.lifecycleVersion ||
          channel.readyState !== "open"
        ) {
          throw new Error("Передача файла отменена");
        }
        // Backpressure must be checked before each ordered chunk.
        // eslint-disable-next-line no-await-in-loop
        await wait(20);
      }
      if (
        lifecycleVersion !== this.lifecycleVersion ||
        channel.readyState !== "open"
      ) {
        throw new Error("Передача файла отменена");
      }
      // Preserve chunk order on the RTC data channel.
      // eslint-disable-next-line no-await-in-loop
      const chunk = await blob.slice(offset, offset + chunkSize).arrayBuffer();
      if (
        lifecycleVersion !== this.lifecycleVersion ||
        channel.readyState !== "open"
      ) {
        throw new Error("Передача файла отменена");
      }
      channel.send(chunk);
    }
    if (
      lifecycleVersion !== this.lifecycleVersion ||
      channel.readyState !== "open"
    ) {
      throw new Error("Передача файла отменена");
    }
    channel.send(JSON.stringify({ type: "file-end", transferId }));
  }

  removePeer(participantId) {
    const disconnectTimer = this.disconnectTimers.get(participantId);
    if (disconnectTimer) globalThis.clearTimeout(disconnectTimer);
    this.disconnectTimers.delete(participantId);
    const existed =
      this.peers.has(participantId) || this.channels.has(participantId);
    this.peerVersions.set(
      participantId,
      (this.peerVersions.get(participantId) || 0) + 1
    );
    this.peers.get(participantId)?.close();
    this.peers.delete(participantId);
    this.pendingCandidates.delete(participantId);
    this.pendingInvites.delete(participantId);
    this.invitePromises.delete(participantId);
    this.signalPromises.delete(participantId);
    this.channels.get(participantId)?.close();
    this.channels.delete(participantId);
    this.incomingFiles.delete(participantId);
    if (existed) this.onPeerClosed?.(participantId);
  }

  stop() {
    this.lifecycleVersion += 1;
    [...this.peers.keys()].forEach((id) => this.removePeer(id));
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.startPromise = null;
    this.pendingInvites.clear();
    this.invitePromises.clear();
    this.signalPromises.clear();
    for (const timer of this.disconnectTimers.values()) {
      globalThis.clearTimeout(timer);
    }
    this.disconnectTimers.clear();
    this.incomingFiles.clear();
    this.channels.clear();
  }
}
