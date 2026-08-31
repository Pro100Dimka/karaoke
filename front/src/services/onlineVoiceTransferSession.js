import { translateSaved } from "../i18n/runtime";
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

// Owns all file/channel state. Voice transport supplies only connection operations
// and lifecycle callbacks; it never reaches into pending transfers.
export default class OnlineVoiceTransferSession {
  constructor(connection, handlers) {
    this.connection = connection;
    Object.assign(this, handlers);
    this.channels = new Map();
    this.incomingFiles = new Map();
    this.incomingFileAdmissions = new Map();
    this.pendingTransferConfirmations = new Map();
    this.pendingTransferAdmissions = new Map();
    this.pendingTransferCredits = new Map();
    this.outboundTransfers = new Map();
  }

  get lifecycleVersion() {
    return this.connection.version();
  }

  hasPeer(id) {
    return this.connection.hasPeer(id);
  }

  invite(id) {
    return this.connection.invite(id);
  }

  hasChannel(id) {
    return this.channels.has(id);
  }

  participantIds() {
    return this.channels.keys();
  }

  setupDataChannel(id, channel) {
    return setupDataChannel(this, id, channel);
  }

  emitTransferProgress(...args) {
    return emitTransferProgress(this, ...args);
  }

  createIncomingTransferTimer(...args) {
    return createIncomingTransferTimer(this, ...args);
  }

  waitForDataChannel(...args) {
    return waitForDataChannel(this, ...args);
  }

  sendFile(...args) {
    return sendFile(this, ...args);
  }

  sendSongSyncError(...args) {
    return sendSongSyncError(this, ...args);
  }

  cancelTransfersByCommandId(...args) {
    return cancelTransfersByCommandId(this, ...args);
  }

  removePeer(id) {
    const channel = this.channels.get(id);
    cancelOutboundTransfers(
      this,
      id,
      null,
      new Error(
        translateSaved("room.participantDisconnectedDuringTransferSendTheFileAgainInterrupted")
      )
    );
    const admission = this.incomingFileAdmissions.get(id);
    if (admission) {
      admission.cancelled = true;
      globalThis.clearTimeout(admission.timer);
      this.emitTransferProgress(id, TRANSFER_STAGES.CANCELLED, 0, admission.metadata);
    }
    this.incomingFileAdmissions.delete(id);
    const incoming = this.incomingFiles.get(id);
    cleanupIncomingTransfer(incoming);
    this.incomingFiles.delete(id);
    if (incoming)
      this.emitTransferProgress(
        id,
        TRANSFER_STAGES.CANCELLED,
        incoming.lastPercent,
        incoming.metadata
      );
    this.channels.delete(id);
    channel?.close();
  }

  stop() {
    for (const id of new Set([
      ...this.channels.keys(),
      ...this.incomingFiles.keys(),
      ...this.incomingFileAdmissions.keys()
    ]))
      this.removePeer(id);
    for (const active of this.outboundTransfers.values()) {
      active.cancelled = true;
      active.controller?.abort();
    }
    cancelOutboundTransfers(
      this,
      null,
      null,
      new Error(translateSaved("room.fileTransferCanceled"))
    );
    this.outboundTransfers.clear();
  }
}
