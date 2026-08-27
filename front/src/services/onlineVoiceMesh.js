import { api } from "../api/client";
// eslint-disable-next-line import/extensions
import { translateSaved } from "../i18n/runtime";
import { closeAudioContext, closeAudioContextQuietly } from "../utils/audio-context";
import { MICROPHONE_CAPTURE_CONSTRAINTS } from "../utils/microphone-capture-constraints";
import { createStudioMicrophoneGraph } from "./microphoneStudioQuality";
// Audio is transferred directly between participants. The Worker is used only
// for signalling, therefore microphone data is never stored in the cloud.

import { TRANSFER_STAGES } from "./onlineVoiceTransferProtocol";
import { cleanupIncomingTransfer } from "./onlineVoiceTransferStorage";
import {
  cancelOutboundTransfers,
  cancelTransfersByCommandId,
  createIncomingTransferTimer,
  emitTransferProgress,
  sendFile,
  sendSongSyncError,
  setupDataChannel,
  waitForDataChannel
} from "./onlineVoiceTransfers";

const MAX_PENDING_ICE_CANDIDATES = 256;
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
    this.incomingFileAdmissions = new Map();
    this.pendingTransferConfirmations = new Map();
    this.pendingTransferAdmissions = new Map();
    this.pendingTransferCredits = new Map();
    this.outboundTransfers = new Map();
    this.stream = null;
    this.microphoneGraph = null;
    this.startPromise = null;
    this.lifecycleVersion = 0;
    this.onRemoteStream = null;
    this.onPeerClosed = null;
    this.canAcceptFile = null;
    this.onFile = null;
    this.onSongPullRequest = null;
    this.onSongPullError = null;
    this.onTransferProgress = null;
    this.disconnectTimers = new Map();
  }

  async start() {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new Error(translateSaved("Захват микрофона не поддерживается в этом окружении"));
    }
    // Checked before any await below: two calls to start() landing in the
    // same tick (e.g. two components each mounting and calling voice.start()
    // on room join) must not both pass the stale-stream cleanup below and
    // race to close/null the same microphoneGraph.
    if (this.startPromise) return this.startPromise;
    const liveStream = this.stream?.getAudioTracks?.().some((track) => track.readyState === "live");
    if (liveStream) return this.stream;
    if (this.stream) {
      if (this.microphoneGraph) {
        await closeAudioContext(this.microphoneGraph);
        this.microphoneGraph = null;
      } else this.stream.getTracks?.().forEach((track) => track.stop());
      this.stream = null;
    }
    const { lifecycleVersion } = this;
    let capturedStream;
    const startPromise = navigator.mediaDevices
      .getUserMedia({
        audio: {
          ...MICROPHONE_CAPTURE_CONSTRAINTS,
          channelCount: 1,
          latency: { ideal: 0 },
          sampleRate: { ideal: 41_000 },
          sampleSize: { ideal: 24 }
        }
      })
      .then(async (stream) => {
        capturedStream = stream;
        if (lifecycleVersion !== this.lifecycleVersion) {
          stream.getTracks().forEach((track) => track.stop());
          throw new Error(translateSaved("Запуск микрофона отменён"));
        }
        // The graph otherwise defaults to a stale/hardcoded noise-suppression
        // level until some settings save happens to dispatch
        // "audio-settings-changed" -- read the persisted value up front so a
        // room call actually starts with whatever the user last saved.
        const persistedSettings = await api.getAudioSettings().catch(() => null);
        this.microphoneGraph = createStudioMicrophoneGraph(stream, {
          noiseSuppression: persistedSettings?.noise_suppression
        });
        const outgoingStream = this.microphoneGraph.stream || stream;
        this.stream = outgoingStream;
        outgoingStream.getAudioTracks().forEach((track) => {
          track.contentHint = "music";
        });
        for (const [participantId, peer] of this.peers) {
          const existingTrackIds = new Set(
            // Stryker disable next-line MethodExpression: track IDs are non-empty.
            peer
              .getSenders()
              .map((sender) => sender.track?.id)
              .filter(Boolean)
          );
          outgoingStream.getTracks().forEach((track) => {
            if (!existingTrackIds.has(track.id)) peer.addTrack(track, stream);
          });
          await this.optimizeAudioSenders(peer);
          this.pendingInvites.add(participantId);
        }
        const pending = [...this.pendingInvites];
        this.pendingInvites.clear();
        await Promise.allSettled(pending.map((participantId) => this.invite(participantId)));
        return outgoingStream;
      })
      .catch(async (error) => {
        if (this.microphoneGraph?.rawStream === capturedStream) {
          await closeAudioContext(this.microphoneGraph);
          this.microphoneGraph = null;
          this.stream = null;
        } else capturedStream?.getTracks?.().forEach((track) => track.stop());
        throw error;
      })
      .finally(() => {
        if (this.startPromise === startPromise) this.startPromise = null;
      });
    this.startPromise = startPromise;
    return startPromise;
  }

  getMeterStream() {
    return this.microphoneGraph?.rawStream || this.stream;
  }

  createPeer(participantId) {
    if (typeof participantId !== "string" || !participantId || participantId.length > 128) {
      throw new TypeError(translateSaved("Некорректный идентификатор участника"));
    }
    if (typeof globalThis.RTCPeerConnection !== "function") {
      throw new Error(translateSaved("WebRTC не поддерживается в этом окружении"));
    }
    const current = this.peers.get(participantId);
    if (current) return current;
    const peer = new globalThis.RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }]
    });
    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        peer.addTrack(track, this.stream);
      });
      // The microphone was already running when this peer joined, so unlike
      // the peers start() itself walks and optimizes when the mic first
      // comes up, nothing has applied bitrate/priority encoding params to
      // this brand-new peer's senders yet.
      this.optimizeAudioSenders(peer);
    }
    const isCurrentPeer = () => this.peers.get(participantId) === peer;
    peer.onicecandidate = ({ candidate }) => {
      if (!candidate || !isCurrentPeer()) return;
      this.roomClient.send("signal", { targetId: participantId, signal: { candidate } });
    };
    peer.ontrack = ({ receiver, streams }) => {
      const stream = streams[0];
      if (!stream) return;
      if (!isCurrentPeer()) {
        stream.getTracks?.().forEach((track) => track.stop());
        return;
      }
      // Singing is more sensitive to delay than speech. Chromium still
      // clamps these hints when the network needs a larger safety buffer.
      for (const [property, value] of [
        ["jitterBufferTarget", 0],
        ["playoutDelayHint", 0]
      ]) {
        try {
          if (property in (receiver || {})) receiver[property] = value;
        } catch {
          // Older WebRTC implementations may expose a read-only hint.
        }
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
    peer.oniceconnectionstatechange = () => {
      if (!isCurrentPeer()) return;
      console.info("WebRTC ICE state changed", {
        participantId,
        iceConnectionState: peer.iceConnectionState
      });
    };
    peer.onconnectionstatechange = () => {
      if (!isCurrentPeer()) return;
      console.info("WebRTC connection state changed", {
        participantId,
        connectionState: peer.connectionState
      });
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
          if (isCurrentPeer() && peer.connectionState === "disconnected")
            this.removePeer(participantId);
        }, 10_000);
        this.disconnectTimers.set(participantId, timer);
      }
    };
    this.peers.set(participantId, peer);
    return peer;
  }

  async optimizeAudioSenders(peer) {
    await Promise.allSettled(
      peer
        .getSenders()
        .filter((sender) => sender.track?.kind === "audio" && sender.setParameters)
        .map(async (sender) => {
          const parameters = sender.getParameters();
          const encodings = parameters.encodings?.length ? parameters.encodings : [{}];
          parameters.encodings = encodings.map((encoding) => ({
            ...encoding,
            maxBitrate: 256_000,
            networkPriority: "high"
          }));
          parameters.degradationPreference = "maintain-framerate";
          await sender.setParameters(parameters);
        })
    );
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
      if (this.invitePromises.get(participantId) === invitePromise)
        this.invitePromises.delete(participantId);
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
            throw new Error(translateSaved("Получено слишком много ICE-кандидатов"));
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
        if (this.signalPromises.get(fromId) === signalPromise) this.signalPromises.delete(fromId);
      });
    this.signalPromises.set(fromId, signalPromise);
    return signalPromise;
  }

  setMicrophoneMuted(muted) {
    this.stream?.getAudioTracks?.().forEach((track) => {
      track.enabled = !muted;
    });
  }

  setupDataChannel(participantId, channel) {
    return setupDataChannel(this, participantId, channel);
  }

  emitTransferProgress(participantId, stage, percent, metadata = {}) {
    return emitTransferProgress(this, participantId, stage, percent, metadata);
  }

  createIncomingTransferTimer(participantId, transferId) {
    return createIncomingTransferTimer(this, participantId, transferId);
  }

  waitForDataChannel(participantId, timeoutMs, lifecycleVersion, signal) {
    return waitForDataChannel(
      this,
      participantId,
      timeoutMs,
      lifecycleVersion ?? this.lifecycleVersion,
      signal
    );
  }

  sendFile(participantId, blob, metadata = {}, options = {}) {
    return sendFile(this, participantId, blob, metadata, options);
  }

  sendSongSyncError(participantId, commandId, error) {
    return sendSongSyncError(this, participantId, commandId, error);
  }

  cancelTransfersByCommandId(commandId, error) {
    return cancelTransfersByCommandId(this, commandId, error);
  }

  removePeer(participantId) {
    const disconnectTimer = this.disconnectTimers.get(participantId);
    if (disconnectTimer) globalThis.clearTimeout(disconnectTimer);
    this.disconnectTimers.delete(participantId);
    const existed = this.peers.has(participantId) || this.channels.has(participantId);
    this.peerVersions.set(participantId, (this.peerVersions.get(participantId) || 0) + 1);
    this.peers.get(participantId)?.close();
    this.peers.delete(participantId);
    this.pendingCandidates.delete(participantId);
    this.pendingInvites.delete(participantId);
    this.invitePromises.delete(participantId);
    this.signalPromises.delete(participantId);
    const channel = this.channels.get(participantId);
    // No partial-transfer resume exists once the peer connection drops -- a
    // retry always restarts the file from the beginning, so the message
    // says so up front instead of leaving the sender to discover it.
    cancelOutboundTransfers(
      this,
      participantId,
      null,
      new Error(
        translateSaved(
          "Участник отключился во время передачи. Отправьте файл заново — продолжить прерванную передачу нельзя."
        )
      )
    );
    const admission = this.incomingFileAdmissions.get(participantId);
    if (admission) {
      admission.cancelled = true;
      globalThis.clearTimeout(admission.timer);
      this.emitTransferProgress(participantId, TRANSFER_STAGES.CANCELLED, 0, admission.metadata);
    }
    this.incomingFileAdmissions.delete(participantId);
    const incoming = this.incomingFiles.get(participantId);
    cleanupIncomingTransfer(incoming);
    this.incomingFiles.delete(participantId);
    // A peer we're receiving a file FROM can vanish mid-transfer too (host
    // disconnects while pushing a song, network drop, tab closed, ...). Without
    // this, the transfer state was wiped silently and whoever was awaiting an
    // "error"/"cancelled" progress event (OnlineRoomContext's pending song
    // command, syncSong()'s promise) would hang until a generic multi-minute
    // timeout instead of failing right away.
    if (incoming)
      this.emitTransferProgress(
        participantId,
        "cancelled",
        incoming.lastPercent,
        incoming.metadata
      );
    channel?.close();
    this.channels.delete(participantId);
    if (existed) this.onPeerClosed?.(participantId);
  }

  stop() {
    this.lifecycleVersion += 1;
    new Set([...this.peers.keys(), ...this.channels.keys()]).forEach((id) => this.removePeer(id));
    if (this.microphoneGraph) {
      closeAudioContextQuietly(this.microphoneGraph);
      this.microphoneGraph = null;
    } else this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.startPromise = null;
    this.pendingInvites.clear();
    this.invitePromises.clear();
    this.signalPromises.clear();
    for (const timer of this.disconnectTimers.values()) {
      globalThis.clearTimeout(timer);
    }
    this.disconnectTimers.clear();
    for (const transfer of this.incomingFiles.values()) cleanupIncomingTransfer(transfer);
    this.incomingFiles.clear();
    for (const admission of this.incomingFileAdmissions.values()) admission.cancelled = true;
    this.incomingFileAdmissions.clear();
    cancelOutboundTransfers(this, null, null, new Error(translateSaved("Передача файла отменена")));
    this.outboundTransfers.clear();
    this.channels.clear();
  }
}
