import { translateSaved as translate } from "../i18n/runtime";
import { acquireMicrophone } from "./microphoneCapture";
import { cleanupIncomingTransfer } from "./onlineVoiceTransferStorage";
import {
  cancelOutboundTransfers,
  cancelTransfersByCommandId,
  createIncomingTransferTimer,
  emitTransferProgress,
  sendFile,
  setupDataChannel,
  waitForDataChannel
} from "./onlineVoiceTransfers";

const ICE_LIMIT = 256;
const validParticipant = (id) => typeof id === "string" && id.length > 0 && id.length <= 128;

export default class OnlineVoiceMesh {
  constructor(roomClient) {
    Object.assign(this, {
      roomClient,
      peers: new Map(),
      pendingCandidates: new Map(),
      pendingInvites: new Set(),
      invitePromises: new Map(),
      signalPromises: new Map(),
      peerVersions: new Map(),
      channels: new Map(),
      incomingFiles: new Map(),
      incomingFileAdmissions: new Map(),
      pendingTransferConfirmations: new Map(),
      pendingTransferAdmissions: new Map(),
      pendingTransferCredits: new Map(),
      outboundTransfers: new Map(),
      disconnectTimers: new Map(),
      stream: null,
      microphoneGraph: null,
      microphoneLease: null,
      startPromise: null,
      lifecycleVersion: 0,
      onRemoteStream: null,
      onPeerClosed: null,
      canAcceptFile: null,
      onFile: null,
      onTransferProgress: null
    });
  }

  async start() {
    if (!globalThis.navigator?.mediaDevices?.getUserMedia)
      throw new Error(translate("Захват микрофона не поддерживается в этом окружении"));
    if (this.stream?.getAudioTracks?.().some(({ readyState }) => readyState === "live"))
      return this.stream;
    if (this.stream) {
      await this.microphoneLease?.release();
      Object.assign(this, { microphoneLease: null, microphoneGraph: null, stream: null });
    }
    if (this.startPromise) return this.startPromise;
    const version = this.lifecycleVersion;
    let lease;
    const operation = acquireMicrophone()
      .then(async (capture) => {
        lease = capture;
        if (version !== this.lifecycleVersion) {
          await capture.release();
          throw new Error(translate("Запуск микрофона отменён"));
        }
        this.microphoneLease = capture;
        this.stream = capture.stream;
        this.stream.getAudioTracks().forEach((track) => {
          track.contentHint = "music";
        });
        for (const [id, peer] of this.peers) {
          const sent = new Set(
            peer
              .getSenders()
              .map(({ track }) => track?.id)
              .filter(Boolean)
          );
          this.stream.getTracks().forEach((track) => {
            if (!sent.has(track.id)) peer.addTrack(track, this.stream);
          });
          await this.optimizeAudioSenders(peer);
          this.pendingInvites.add(id);
        }
        const invites = [...this.pendingInvites];
        this.pendingInvites.clear();
        await Promise.allSettled(invites.map((id) => this.invite(id)));
        return this.stream;
      })
      .catch(async (error) => {
        if (this.microphoneLease === lease) this.microphoneLease = null;
        await lease?.release();
        Object.assign(this, { microphoneGraph: null, stream: null });
        throw error;
      })
      .finally(() => {
        if (this.startPromise === operation) this.startPromise = null;
      });
    this.startPromise = operation;
    return operation;
  }

  createPeer(participantId) {
    if (!validParticipant(participantId))
      throw new TypeError(translate("Некорректный идентификатор участника"));
    if (typeof globalThis.RTCPeerConnection !== "function")
      throw new Error(translate("WebRTC не поддерживается в этом окружении"));
    if (this.peers.has(participantId)) return this.peers.get(participantId);
    const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] });
    this.stream?.getTracks().forEach((track) => peer.addTrack(track, this.stream));
    if (this.stream) this.optimizeAudioSenders(peer);
    const current = () => this.peers.get(participantId) === peer;
    peer.onicecandidate = ({ candidate }) => {
      if (candidate && current())
        this.roomClient.send("signal", { targetId: participantId, signal: { candidate } });
    };
    peer.ontrack = ({ streams }) => {
      const stream = streams[0];
      if (!stream) return;
      if (current()) this.onRemoteStream?.(participantId, stream);
      else stream.getTracks?.().forEach((track) => track.stop());
    };
    peer.ondatachannel = ({ channel }) =>
      current() ? this.setupDataChannel(participantId, channel) : channel.close?.();
    peer.onconnectionstatechange = () => {
      if (!current()) return;
      const timer = this.disconnectTimers.get(participantId);
      if (timer) clearTimeout(timer);
      this.disconnectTimers.delete(participantId);
      if (["failed", "closed"].includes(peer.connectionState))
        return this.removePeer(participantId);
      if (peer.connectionState === "disconnected")
        this.disconnectTimers.set(
          participantId,
          setTimeout(() => {
            this.disconnectTimers.delete(participantId);
            if (current() && peer.connectionState === "disconnected")
              this.removePeer(participantId);
          }, 10_000)
        );
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
          parameters.encodings = (parameters.encodings?.length ? parameters.encodings : [{}]).map(
            (encoding) => ({ ...encoding, maxBitrate: 256_000, networkPriority: "high" })
          );
          parameters.degradationPreference = "maintain-framerate";
          await sender.setParameters(parameters);
        })
    );
  }

  invite(participantId) {
    if (!participantId) return Promise.resolve(false);
    if (this.invitePromises.has(participantId)) return this.invitePromises.get(participantId);
    const version = this.lifecycleVersion;
    const peer = this.createPeer(participantId);
    const current = () =>
      version === this.lifecycleVersion &&
      this.peers.get(participantId) === peer &&
      peer.connectionState !== "closed";
    const operation = (async () => {
      // Do not start a second offer while an incoming/outgoing SDP exchange is still active.
      // Creating the data channel before setLocalDescription in that state can leave a
      // permanently `connecting` zombie channel, which later makes song transfers time out.
      if (
        this.signalPromises.has(participantId) ||
        (peer.signalingState && peer.signalingState !== "stable")
      )
        return false;

      let createdChannel = null;
      const discardCreatedChannel = () => {
        if (!createdChannel || this.channels.get(participantId) !== createdChannel) return;
        if (createdChannel.readyState === "open") return;
        this.channels.delete(participantId);
        createdChannel.close?.();
      };

      if (!this.channels.has(participantId)) {
        createdChannel = peer.createDataChannel("karaoke-library", { ordered: true });
        this.setupDataChannel(participantId, createdChannel);
      }
      try {
        const offer = await peer.createOffer();
        if (!current()) {
          discardCreatedChannel();
          return false;
        }
        await peer.setLocalDescription(offer);
        const sent =
          current() && peer.localDescription
            ? this.roomClient.send("signal", {
                targetId: participantId,
                signal: { description: peer.localDescription }
              })
            : false;
        if (!sent) discardCreatedChannel();
        return Boolean(sent);
      } catch (error) {
        discardCreatedChannel();
        if (!current()) return false;
        throw error;
      }
    })().finally(() => {
      if (this.invitePromises.get(participantId) === operation)
        this.invitePromises.delete(participantId);
    });
    this.invitePromises.set(participantId, operation);
    return operation;
  }

  accept(fromId, signal) {
    if (!validParticipant(fromId) || !signal || typeof signal !== "object" || Array.isArray(signal))
      return Promise.resolve(false);
    const peerVersion = this.peerVersions.get(fromId) || 0;
    const previous = this.signalPromises.get(fromId) || Promise.resolve();
    const operation = previous
      .catch(() => {})
      .then(async () => {
        if ((this.peerVersions.get(fromId) || 0) !== peerVersion) return false;
        const lifecycle = this.lifecycleVersion;
        const peer = this.createPeer(fromId);
        const current = () =>
          lifecycle === this.lifecycleVersion &&
          (this.peerVersions.get(fromId) || 0) === peerVersion &&
          this.peers.get(fromId) === peer &&
          peer.connectionState !== "closed";
        if (signal.candidate) {
          if (!current()) return false;
          if (peer.remoteDescription) {
            await peer.addIceCandidate(signal.candidate);
            return current();
          }
          const pending = this.pendingCandidates.get(fromId) || [];
          if (pending.length >= ICE_LIMIT) {
            this.removePeer(fromId);
            throw new Error(translate("Получено слишком много ICE-кандидатов"));
          }
          pending.push(signal.candidate);
          this.pendingCandidates.set(fromId, pending);
          return true;
        }
        if (!signal.description) return false;
        await peer.setRemoteDescription(signal.description);
        if (!current()) return false;
        const candidates = this.pendingCandidates.get(fromId) || [];
        this.pendingCandidates.delete(fromId);
        for (const candidate of candidates) {
          if (!current()) return false;
          await peer.addIceCandidate(candidate);
        }
        if (signal.description.type !== "offer") return true;
        const answer = await peer.createAnswer();
        if (!current()) return false;
        await peer.setLocalDescription(answer);
        return current() && peer.localDescription
          ? this.roomClient.send("signal", {
              targetId: fromId,
              signal: { description: peer.localDescription }
            })
          : false;
      })
      .finally(() => {
        if (this.signalPromises.get(fromId) === operation) this.signalPromises.delete(fromId);
      });
    this.signalPromises.set(fromId, operation);
    return operation;
  }

  setMicrophoneMuted(muted) {
    this.stream?.getAudioTracks?.().forEach((track) => {
      track.enabled = !muted;
    });
  }

  setupDataChannel(id, channel) {
    return setupDataChannel(this, id, channel);
  }

  emitTransferProgress(id, stage, percent, metadata = {}) {
    return emitTransferProgress(this, id, stage, percent, metadata);
  }

  createIncomingTransferTimer(id, transferId) {
    return createIncomingTransferTimer(this, id, transferId);
  }

  waitForDataChannel(id, timeout, version, signal) {
    return waitForDataChannel(this, id, timeout, version ?? this.lifecycleVersion, signal);
  }

  sendFile(id, blob, metadata = {}, options = {}) {
    return sendFile(this, id, blob, metadata, options);
  }

  cancelTransfersByCommandId(commandId, error) {
    return cancelTransfersByCommandId(this, commandId, error);
  }

  removePeer(id) {
    const timer = this.disconnectTimers.get(id);
    if (timer) clearTimeout(timer);
    this.disconnectTimers.delete(id);
    const existed = this.peers.has(id) || this.channels.has(id);
    this.peerVersions.set(id, (this.peerVersions.get(id) || 0) + 1);
    this.peers.get(id)?.close();
    this.peers.delete(id);
    this.pendingCandidates.delete(id);
    this.pendingInvites.delete(id);
    this.invitePromises.delete(id);
    this.signalPromises.delete(id);
    cancelOutboundTransfers(
      this,
      id,
      null,
      new Error(translate("Участник отключился во время передачи"))
    );
    const admission = this.incomingFileAdmissions.get(id);
    if (admission) {
      admission.cancelled = true;
      clearTimeout(admission.timer);
    }
    this.incomingFileAdmissions.delete(id);
    cleanupIncomingTransfer(this.incomingFiles.get(id));
    this.incomingFiles.delete(id);
    this.channels.get(id)?.close();
    this.channels.delete(id);
    if (existed) this.onPeerClosed?.(id);
  }

  stop() {
    this.lifecycleVersion += 1;
    new Set([...this.peers.keys(), ...this.channels.keys()]).forEach((id) => this.removePeer(id));
    this.microphoneLease?.release();
    Object.assign(this, {
      microphoneLease: null,
      microphoneGraph: null,
      stream: null,
      startPromise: null
    });
    this.pendingInvites.clear();
    this.invitePromises.clear();
    this.signalPromises.clear();
    this.disconnectTimers.forEach((timer) => clearTimeout(timer));
    this.disconnectTimers.clear();
    this.incomingFiles.forEach((transfer) => cleanupIncomingTransfer(transfer));
    this.incomingFiles.clear();
    this.incomingFileAdmissions.forEach((entry) => {
      entry.cancelled = true;
    });
    this.incomingFileAdmissions.clear();
    cancelOutboundTransfers(this, null, null, new Error(translate("Передача файла отменена")));
    this.outboundTransfers.clear();
    this.channels.clear();
  }
}
