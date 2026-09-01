import { translateSaved } from "../i18n/runtime";
// eslint-disable-next-line import/extensions
import {
  TRANSFER_STAGES,
  TRANSFER_LIMITS,
  TRANSFER_TIMEOUTS,
  TRANSFER_CHUNK_BYTES,
  TRANSFER_RESUME_TTL_MS,
  cancelOutboundTransferById,
  digestHex,
  hashChunkManifest,
  rejectPendingTransfers,
  sendTransferStatus
} from "./onlineVoiceTransferProtocol";
import { cleanupIncomingTransfer, createTransferSink } from "./onlineVoiceTransferStorage";

export { sendFile, waitForDataChannel } from "./onlineVoiceTransferOutbound";

const getBinaryChunk = (data) => {
  if (data instanceof ArrayBuffer) return data;
  if (!ArrayBuffer.isView(data)) return null;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
};

// Credit is only replenished once the receiver's disk write of a chunk
// actually completes (see the file-credit send after transfer.writes settles
// below), so this window directly caps how many chunks can be in flight
// before the sender must stall on a write+ack round trip. 512KB (16 chunks
// at the 32KB chunk size) made every ~16 chunks pay for a full round trip on
// a local P2P transfer that should otherwise run at line-rate; a much larger
// window lets many more chunks queue ahead of that gating.

const isValidTransferSize = (size) =>
  Number.isSafeInteger(size) && size >= 0 && size <= TRANSFER_LIMITS.fileBytes;

export function cancelOutboundTransfers(
  transfers,
  participantId,
  channel,
  error = new Error(translateSaved("room.theSongTransmissionChannelIsClosed"))
) {
  const matches = (entry) =>
    (!participantId || entry.participantId === participantId) &&
    (!channel || entry.channel === channel);
  rejectPendingTransfers(transfers, matches, error);
}

function cancelIncomingByTransferId(transfers, participantId, channel, transferId) {
  const admission = transfers.incomingFileAdmissions.get(participantId);
  if (admission?.channel === channel && admission.transferId === transferId) {
    admission.cancelled = true;
    globalThis.clearTimeout(admission.timer);
    transfers.incomingFileAdmissions.delete(participantId);
  }
  const transfer = transfers.incomingFiles.get(participantId);
  if (transfer?.channel === channel && transfer.metadata.transferId === transferId) {
    transfers.incomingFiles.delete(participantId);
    cleanupIncomingTransfer(transfer);
    transfers.emitTransferProgress(
      participantId,
      TRANSFER_STAGES.CANCELLED,
      transfer.lastPercent,
      transfer.metadata
    );
  }
  const partial = transfers.resumableIncomingFiles.get(participantId);
  if (partial?.metadata.transferId === transferId) {
    globalThis.clearTimeout(partial.resumeTimer);
    transfers.resumableIncomingFiles.delete(participantId);
    cleanupIncomingTransfer(partial);
  }
}

export function cancelTransfersByCommandId(
  transfers,
  commandId,
  error = new Error(translateSaved("room.fileTransferCanceled"))
) {
  if (!commandId) return;
  for (const [transferId, active] of transfers.outboundTransfers) {
    if (active.commandId !== commandId) continue;
    active.cancelled = true;
    active.controller?.abort?.();
    if (active.channel?.readyState === "open")
      sendTransferStatus(active.channel, { type: "file-cancel", transferId });
    cancelOutboundTransferById(transfers, transferId, error);
  }
  for (const [participantId, admission] of transfers.incomingFileAdmissions) {
    if (admission.metadata?.commandId !== commandId) continue;
    cancelIncomingByTransferId(transfers, participantId, admission.channel, admission.transferId);
  }
  for (const [participantId, transfer] of transfers.incomingFiles) {
    if (transfer.metadata?.commandId !== commandId) continue;
    cancelIncomingByTransferId(
      transfers,
      participantId,
      transfer.channel,
      transfer.metadata.transferId
    );
  }
}

function parseDataMessage(data) {
  if (data.length > TRANSFER_LIMITS.message) return null;
  try {
    const message = JSON.parse(data);
    return message && !Array.isArray(message) ? message : null;
  } catch {
    return null;
  }
}

function rejectPendingTransfer(transfers, participantId, channel, message) {
  const error = new Error(
    typeof message.error === "string" && message.error
      ? message.error.slice(0, 500)
      : translateSaved("room.receiverCouldNotReceiveTheSong")
  );
  error.retryable = message.retryable === true;
  const flow = transfers.pendingTransferCredits.get(message.transferId);
  if (flow?.participantId === participantId && flow.channel === channel) {
    flow.error = error;
    flow.waiters.forEach((waiter) => {
      globalThis.clearTimeout(waiter.timer);
      waiter.reject(error);
    });
    flow.waiters.length = 0;
  }
  for (const store of [
    transfers.pendingTransferAdmissions,
    transfers.pendingTransferConfirmations
  ]) {
    const pending = store.get(message.transferId);
    if (!pending || pending.participantId !== participantId || pending.channel !== channel)
      continue;
    store.delete(message.transferId);
    globalThis.clearTimeout(pending.timer);
    pending.reject(error);
    return;
  }
}

function handleFileCredit(transfers, participantId, channel, message) {
  const flow = transfers.pendingTransferCredits.get(message.transferId);
  const bytes = Number(message.bytes);
  if (
    !flow ||
    flow.participantId !== participantId ||
    flow.channel !== channel ||
    !Number.isFinite(bytes) ||
    bytes <= 0
  )
    return;
  flow.available = Math.min(TRANSFER_LIMITS.pendingWriteBytes, flow.available + bytes);
  while (flow.waiters.length && flow.available >= flow.waiters[0].bytes) {
    const waiter = flow.waiters.shift();
    flow.available -= waiter.bytes;
    globalThis.clearTimeout(waiter.timer);
    waiter.resolve();
  }
}

function handleTransferConfirmation(transfers, participantId, channel, message) {
  if (message.type === "file-error")
    return rejectPendingTransfer(transfers, participantId, channel, message);
  const store =
    message.type === "file-ready"
      ? transfers.pendingTransferAdmissions
      : transfers.pendingTransferConfirmations;
  const pending = store.get(message.transferId);
  if (!pending || pending.participantId !== participantId || pending.channel !== channel) return;
  store.delete(message.transferId);
  globalThis.clearTimeout(pending.timer);
  pending.resolve(message);
}

function normalizeTransferMetadata(message) {
  const transferId = typeof message.transferId === "string" ? message.transferId : "";
  if (
    !transferId ||
    transferId.length > TRANSFER_LIMITS.transferId ||
    !isValidTransferSize(message.size)
  ) {
    return null;
  }
  const metadata = {
    type: "file-start",
    kind: typeof message.kind === "string" ? message.kind.slice(0, 64) : undefined,
    songId: typeof message.songId === "string" ? message.songId.slice(0, 128) : undefined,
    size: message.size,
    transferId,
    filename:
      typeof message.filename === "string"
        ? message.filename.slice(0, TRANSFER_LIMITS.filename)
        : undefined,
    mimeType:
      typeof message.mimeType === "string"
        ? message.mimeType.slice(0, 255)
        : "application/octet-stream"
  };
  if (typeof message.commandId === "string") metadata.commandId = message.commandId.slice(0, 128);
  if (typeof message.revision === "string") metadata.revision = message.revision.slice(0, 80);
  Object.defineProperties(metadata, {
    chunkSize: {
      value: TRANSFER_CHUNK_BYTES,
      enumerable: false
    },
    framedChunks: {
      value: message.chunkSize === TRANSFER_CHUNK_BYTES,
      enumerable: false
    }
  });
  return metadata;
}

function resumeIncomingTransfer(transfers, participantId, channel, metadata) {
  const transfer = transfers.resumableIncomingFiles.get(participantId);
  if (
    !transfer ||
    transfer.metadata.transferId !== metadata.transferId ||
    transfer.metadata.size !== metadata.size
  )
    return false;
  globalThis.clearTimeout(transfer.resumeTimer);
  transfers.resumableIncomingFiles.delete(participantId);
  Object.assign(transfer, {
    metadata,
    channel,
    phase: "receiving",
    cancelled: false,
    cleanupStarted: false,
    received: transfer.written,
    pendingChunk: null,
    writeError: null,
    timer: transfers.createIncomingTransferTimer(participantId, metadata.transferId)
  });
  transfers.incomingFiles.set(participantId, transfer);
  sendTransferStatus(channel, {
    type: "file-ready",
    transferId: metadata.transferId,
    windowBytes: TRANSFER_LIMITS.pendingWriteBytes,
    resumeOffset: transfer.written
  });
  transfers.emitTransferProgress(
    participantId,
    TRANSFER_STAGES.RECEIVING,
    Math.min(99, Math.floor((transfer.written / Math.max(1, metadata.size)) * 100)),
    metadata
  );
  return true;
}

function handleFileStart(transfers, participantId, channel, message) {
  const metadata = normalizeTransferMetadata(message);
  if (!metadata) return;
  if (resumeIncomingTransfer(transfers, participantId, channel, metadata)) return;
  if (
    transfers.incomingFiles.has(participantId) ||
    transfers.incomingFileAdmissions.has(participantId)
  ) {
    sendTransferStatus(channel, {
      type: "file-error",
      transferId: metadata.transferId,
      error: translateSaved("room.receiverIsAlreadyReceivingAnotherFile")
    });
    return;
  }
  const reject = (error) =>
    sendTransferStatus(channel, {
      type: "file-error",
      transferId: metadata.transferId,
      error: error instanceof Error ? error.message : String(error)
    });
  const admission = {
    channel,
    metadata,
    transferId: metadata.transferId,
    cancelled: false,
    timer: null
  };
  const finishAdmission = () => {
    globalThis.clearTimeout(admission.timer);
    if (transfers.incomingFileAdmissions.get(participantId) === admission)
      transfers.incomingFileAdmissions.delete(participantId);
  };
  const accept = (sink) => {
    finishAdmission();
    if (
      admission.cancelled ||
      channel.readyState !== "open" ||
      transfers.channels.get(participantId) !== channel ||
      transfers.incomingFiles.has(participantId)
    ) {
      sink.cleanup();
      throw new Error(translateSaved("room.fileTransferCanNoLongerBeAccepted"));
    }
    transfers.incomingFiles.set(participantId, {
      metadata,
      channel,
      phase: "receiving",
      cancelled: false,
      cleanupStarted: false,
      controller:
        typeof globalThis.AbortController === "function" ? new globalThis.AbortController() : null,
      chunkCount: 0,
      received: 0,
      written: 0,
      pendingChunk: null,
      chunkHashes: new Map(),
      lastPercent: -1,
      chunks: Array.isArray(sink?.chunks) ? sink.chunks : [],
      sink,
      writes: Promise.resolve(),
      timer: transfers.createIncomingTransferTimer(participantId, metadata.transferId)
    });
    transfers.emitTransferProgress(participantId, TRANSFER_STAGES.RECEIVING, 0, metadata);
    sendTransferStatus(channel, {
      type: "file-ready",
      transferId: metadata.transferId,
      windowBytes: TRANSFER_LIMITS.pendingWriteBytes
    });
  };
  const failAdmission = (error) => {
    if (!admission.cancelled) reject(error);
    finishAdmission();
  };
  const createAndAcceptSink = () => {
    if (admission.cancelled)
      throw new Error(translateSaved("room.fileTransferCanNoLongerBeAccepted"));
    const sink = createTransferSink(participantId, metadata);
    if (sink && typeof sink.then === "function") {
      Promise.resolve(sink).then(accept).catch(failAdmission);
      return;
    }
    accept(sink);
  };
  const admitAsync = async (accepted) => {
    try {
      if ((await accepted) !== true) throw new Error(translateSaved("room.fileReceptionRejected"));
      createAndAcceptSink();
    } catch (error) {
      failAdmission(error);
    }
  };
  try {
    const accepted = transfers.canAcceptFile?.(participantId, metadata) ?? true;
    transfers.incomingFileAdmissions.set(participantId, admission);
    admission.timer = globalThis.setTimeout(() => {
      if (transfers.incomingFileAdmissions.get(participantId) !== admission) return;
      admission.cancelled = true;
      transfers.incomingFileAdmissions.delete(participantId);
      reject(new Error(translateSaved("room.songStoragePreparationTimedOut")));
    }, TRANSFER_TIMEOUTS.admission);
    if (accepted && typeof accepted.then === "function") admitAsync(accepted);
    else if (accepted === true) createAndAcceptSink();
    else failAdmission(new Error(translateSaved("room.fileReceptionRejected")));
  } catch (error) {
    failAdmission(error);
  }
}

export function sendSongSyncError(transfers, participantId, commandId, error) {
  const channel = transfers.channels.get(participantId);
  return (
    Boolean(channel) && sendTransferStatus(channel, { type: "song-sync-error", commandId, error })
  );
}

const currentIncomingTransfer = (transfers, participantId, channel) => {
  const transfer = transfers.incomingFiles.get(participantId);
  return transfer?.channel === channel ? transfer : null;
};

const incomingTransferActive = (transfers, participantId, channel, transfer) =>
  !transfer.cancelled &&
  transfers.incomingFiles.get(participantId) === transfer &&
  transfer.channel === channel;

function rejectIncomingTransfer(
  transfers,
  participantId,
  channel,
  transfer,
  error,
  retryable = false
) {
  if (transfers.incomingFiles.get(participantId) === transfer)
    transfers.incomingFiles.delete(participantId);
  transfer.phase = "failed";
  cleanupIncomingTransfer(transfer);
  sendTransferStatus(channel, {
    type: "file-error",
    transferId: transfer.metadata.transferId,
    error,
    retryable
  });
  transfers.emitTransferProgress(
    participantId,
    TRANSFER_STAGES.ERROR,
    transfer.lastPercent,
    transfer.metadata
  );
}

function handleFileEnd(transfers, participantId, channel, message) {
  const transfer = currentIncomingTransfer(transfers, participantId, channel);
  if (!transfer) {
    if (typeof message.transferId === "string")
      sendTransferStatus(channel, {
        type: "file-error",
        transferId: message.transferId,
        error: translateSaved("room.theSongFileWasIncomplete")
      });
    return;
  }
  if (transfer.phase !== "receiving") return;
  if (transfer.metadata.transferId !== message.transferId) {
    sendTransferStatus(channel, {
      type: "file-error",
      transferId: message.transferId,
      error: translateSaved("room.unknownTransferIdentifierReceived")
    });
    return;
  }
  if (transfer.received !== transfer.metadata.size) {
    rejectIncomingTransfer(
      transfers,
      participantId,
      channel,
      transfer,
      translateSaved("room.theSongFileWasIncomplete")
    );
    return;
  }
  if (
    transfer.metadata.framedChunks &&
    (typeof message.manifestHash !== "string" || !/^[a-f0-9]{64}$/.test(message.manifestHash))
  ) {
    rejectIncomingTransfer(
      transfers,
      participantId,
      channel,
      transfer,
      translateSaved("room.receivedFileWasNotAccepted")
    );
    return;
  }

  transfer.phase = "flushing";
  globalThis.clearTimeout(transfer.timer);
  const cancellation = new Promise((resolve) => {
    transfer.cancelFinalization = resolve;
  });
  const cancelled = () => !incomingTransferActive(transfers, participantId, channel, transfer);
  const ensureActive = () => {
    if (cancelled()) throw new Error(translateSaved("room.fileTransferCanceled"));
  };
  const step = (promise, timeoutMs, timeoutMessage) => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = globalThis.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });
    return Promise.race([
      Promise.resolve(promise),
      cancellation.then(() => {
        throw new Error(translateSaved("room.fileTransferCanceled"));
      }),
      timeout
    ])
      .finally(() => globalThis.clearTimeout(timer))
      .then((value) => {
        ensureActive();
        return value;
      });
  };

  step(
    transfer.writes,
    TRANSFER_TIMEOUTS.flush,
    translateSaved("room.writingReceivedSongToDiskTimedOut")
  )
    .then(async () => {
      if (transfer.writeError) throw transfer.writeError;
      if (transfer.written !== transfer.metadata.size)
        throw new Error(translateSaved("room.theSongFileWasIncomplete"));
      if (
        transfer.metadata.framedChunks &&
        (await hashChunkManifest(transfer.chunkHashes)) !== message.manifestHash
      )
        throw new Error(translateSaved("room.receivedFileWasNotAccepted"));
      transfer.phase = "finalizing";
      const file = await step(
        transfer.sink.finish(),
        TRANSFER_TIMEOUTS.close,
        translateSaved("room.closingTemporarySongFileTimedOut")
      );
      transfer.phase = "importing";
      transfer.lastPercent = 100;
      transfers.emitTransferProgress(
        participantId,
        TRANSFER_STAGES.IMPORTING,
        100,
        transfer.metadata
      );
      const accepted = await step(
        transfers.onFile?.(participantId, file, transfer.metadata, transfer.controller?.signal),
        TRANSFER_TIMEOUTS.import,
        translateSaved("room.songImportTimedOut")
      );
      if (accepted !== true) throw new Error(translateSaved("room.receivedFileWasNotAccepted"));
    })
    .then(() => {
      if (!incomingTransferActive(transfers, participantId, channel, transfer)) return;
      transfer.phase = "complete";
      transfers.incomingFiles.delete(participantId);
      globalThis.clearTimeout(transfer.timer);
      sendTransferStatus(channel, { type: "file-complete", transferId: message.transferId });
      transfers.emitTransferProgress(
        participantId,
        TRANSFER_STAGES.COMPLETE,
        100,
        transfer.metadata
      );
    })
    .catch((error) => {
      if (
        transfer.cancelled ||
        transfers.incomingFiles.get(participantId) !== transfer ||
        ["paused", "receiving"].includes(transfer.phase)
      )
        return;
      rejectIncomingTransfer(
        transfers,
        participantId,
        channel,
        transfer,
        error instanceof Error ? error.message : String(error)
      );
    })
    .finally(() => {
      transfer.cancelFinalization = null;
      if (transfers.incomingFiles.get(participantId) === transfer && transfer.phase === "complete")
        transfers.incomingFiles.delete(participantId);
      if (!["paused", "receiving"].includes(transfer.phase)) cleanupIncomingTransfer(transfer);
    });
}

function handleFileCancel(transfers, participantId, channel, message) {
  if (typeof message.transferId !== "string") return;
  cancelIncomingByTransferId(transfers, participantId, channel, message.transferId);
}

function handleFileChunk(transfers, participantId, channel, message) {
  const transfer = currentIncomingTransfer(transfers, participantId, channel);
  const offset = Number(message.offset);
  const size = Number(message.size);
  if (
    !transfer ||
    transfer.phase !== "receiving" ||
    message.transferId !== transfer.metadata.transferId ||
    transfer.pendingChunk ||
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(size) ||
    offset !== transfer.received ||
    size <= 0 ||
    size > TRANSFER_CHUNK_BYTES ||
    offset + size > transfer.metadata.size ||
    typeof message.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(message.sha256)
  ) {
    if (transfer)
      rejectIncomingTransfer(
        transfers,
        participantId,
        channel,
        transfer,
        translateSaved("room.invalidSongFileSizeReceived")
      );
    return;
  }
  transfer.pendingChunk = { offset, size, sha256: message.sha256 };
}

// A song owned by another participant is fetched on demand (library sync, not
// the host-driven "start karaoke" push): the requester asks directly over this
// already-open peer-to-peer channel, and the owner answers with sendFile using
// the same file-* subprotocol above, or a song-sync-error if it can't help.
function handleSongSyncRequest(transfers, participantId, channel, message) {
  if (
    typeof message.commandId !== "string" ||
    !message.commandId ||
    message.commandId.length > TRANSFER_LIMITS.transferId ||
    typeof message.songId !== "string" ||
    !message.songId ||
    message.songId.length > TRANSFER_LIMITS.filename
  )
    return;
  transfers.onSongPullRequest?.(participantId, channel, message);
}

function handleSongSyncError(transfers, participantId, channel, message) {
  if (typeof message.commandId !== "string" || !message.commandId) return;
  transfers.onSongPullError?.(participantId, message);
}

const DATA_MESSAGE_HANDLERS = {
  "file-ready": handleTransferConfirmation,
  "file-complete": handleTransferConfirmation,
  "file-error": handleTransferConfirmation,
  "file-cancel": handleFileCancel,
  "file-credit": handleFileCredit,
  "file-chunk": handleFileChunk,
  "file-start": handleFileStart,
  "file-end": handleFileEnd,
  "song-sync-request": handleSongSyncRequest,
  "song-sync-error": handleSongSyncError
};

function handleStringMessage(transfers, participantId, channel, data) {
  const message = parseDataMessage(data);
  if (Object.hasOwn(DATA_MESSAGE_HANDLERS, message?.type)) {
    DATA_MESSAGE_HANDLERS[message.type](transfers, participantId, channel, message);
  }
}

function handleBinaryChunk(transfers, participantId, channel, data) {
  const transfer = currentIncomingTransfer(transfers, participantId, channel);
  const chunk = getBinaryChunk(data);
  if (!transfer || transfer.phase !== "receiving" || !chunk || chunk.byteLength === 0) return;
  const descriptor =
    transfer.pendingChunk ||
    (!transfer.metadata.framedChunks
      ? { offset: transfer.received, size: chunk.byteLength, sha256: null }
      : null);
  transfer.pendingChunk = null;
  if (
    !descriptor ||
    descriptor.size !== chunk.byteLength ||
    transfer.chunkCount >= TRANSFER_LIMITS.chunks ||
    descriptor.offset + chunk.byteLength > transfer.metadata.size
  ) {
    rejectIncomingTransfer(
      transfers,
      participantId,
      channel,
      transfer,
      translateSaved("room.invalidSongFileSizeReceived")
    );
    return;
  }

  transfer.received = descriptor.offset + chunk.byteLength;
  transfer.chunkCount += 1;
  transfer.writes = transfer.writes
    .then(async () => {
      if (!incomingTransferActive(transfers, participantId, channel, transfer)) return;
      if (descriptor.sha256) {
        const actualHash = await digestHex(chunk);
        if (actualHash !== descriptor.sha256) {
          const error = new Error(translateSaved("room.receivedFileWasNotAccepted"));
          error.retryable = true;
          throw error;
        }
      }
      await transfer.sink.write(chunk, descriptor.offset);
      if (!incomingTransferActive(transfers, participantId, channel, transfer)) return;
      if (descriptor.sha256) transfer.chunkHashes.set(descriptor.offset, descriptor.sha256);
      transfer.written = descriptor.offset + chunk.byteLength;
      sendTransferStatus(channel, {
        type: "file-credit",
        transferId: transfer.metadata.transferId,
        bytes: chunk.byteLength
      });
    })
    .catch((error) => {
      if (transfer.writeError || transfer.cancelled) return;
      if (
        error?.retryable === true &&
        preserveIncomingForResume(transfers, participantId, transfer)
      ) {
        sendTransferStatus(channel, {
          type: "file-error",
          transferId: transfer.metadata.transferId,
          error: error.message,
          retryable: true
        });
        return;
      }
      transfer.writeError = error;
      rejectIncomingTransfer(
        transfers,
        participantId,
        channel,
        transfer,
        error instanceof Error ? error.message : String(error)
      );
    });
  globalThis.clearTimeout(transfer.timer);
  transfer.timer = transfers.createIncomingTransferTimer(
    participantId,
    transfer.metadata.transferId
  );
  const percent = Math.min(99, Math.floor((transfer.received / transfer.metadata.size) * 100));
  if (percent === transfer.lastPercent) return;
  transfer.lastPercent = percent;
  transfers.emitTransferProgress(
    participantId,
    TRANSFER_STAGES.RECEIVING,
    percent,
    transfer.metadata
  );
}

export function preserveIncomingForResume(transfers, participantId, transfer) {
  if (
    !transfer ||
    !transfer.metadata?.framedChunks ||
    !["receiving", "flushing"].includes(transfer.phase) ||
    transfer.cancelled
  )
    return false;
  globalThis.clearTimeout(transfer.timer);
  transfer.cancelFinalization?.();
  transfer.cancelFinalization = null;
  transfers.incomingFiles.delete(participantId);
  const previous = transfers.resumableIncomingFiles.get(participantId);
  if (previous && previous !== transfer) cleanupIncomingTransfer(previous);
  Object.assign(transfer, {
    channel: null,
    phase: "paused",
    received: transfer.written,
    pendingChunk: null,
    resumeTimer: globalThis.setTimeout(() => {
      if (transfers.resumableIncomingFiles.get(participantId) !== transfer) return;
      transfers.resumableIncomingFiles.delete(participantId);
      cleanupIncomingTransfer(transfer);
      transfers.emitTransferProgress(
        participantId,
        TRANSFER_STAGES.ERROR,
        transfer.lastPercent,
        transfer.metadata
      );
    }, TRANSFER_RESUME_TTL_MS)
  });
  transfers.resumableIncomingFiles.set(participantId, transfer);
  transfers.emitTransferProgress(
    participantId,
    TRANSFER_STAGES.WAITING,
    transfer.lastPercent,
    transfer.metadata
  );
  return true;
}

export function setupDataChannel(transfers, participantId, channel) {
  const previousChannel = transfers.channels.get(participantId);
  if (previousChannel && previousChannel !== channel) {
    cancelOutboundTransfers(transfers, participantId, previousChannel);
    const admission = transfers.incomingFileAdmissions.get(participantId);
    if (admission?.channel === previousChannel) {
      admission.cancelled = true;
      transfers.incomingFileAdmissions.delete(participantId);
    }
    const incoming = transfers.incomingFiles.get(participantId);
    if (incoming?.channel === previousChannel) {
      if (!preserveIncomingForResume(transfers, participantId, incoming)) {
        cleanupIncomingTransfer(incoming);
        transfers.incomingFiles.delete(participantId);
      }
    }
    if (previousChannel.readyState !== "closed") previousChannel.close?.();
  }

  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = 256 * 1024;
  channel.onopen = () => {
    console.info("WebRTC data channel opened", { participantId, label: channel.label });
  };
  channel.onmessage = ({ data }) => {
    if (transfers.channels.get(participantId) !== channel) return;
    if (typeof data === "string") {
      handleStringMessage(transfers, participantId, channel, data);
      return;
    }
    handleBinaryChunk(transfers, participantId, channel, data);
  };

  const clearChannel = () => {
    cancelOutboundTransfers(transfers, participantId, channel);
    const admission = transfers.incomingFileAdmissions.get(participantId);
    if (admission?.channel === channel) {
      admission.cancelled = true;
      globalThis.clearTimeout(admission.timer);
      transfers.incomingFileAdmissions.delete(participantId);
      transfers.emitTransferProgress(
        participantId,
        TRANSFER_STAGES.CANCELLED,
        0,
        admission.metadata
      );
    }
    const incoming = transfers.incomingFiles.get(participantId);
    if (incoming?.channel === channel) {
      if (!preserveIncomingForResume(transfers, participantId, incoming)) {
        cleanupIncomingTransfer(incoming);
        transfers.incomingFiles.delete(participantId);
        transfers.emitTransferProgress(
          participantId,
          TRANSFER_STAGES.CANCELLED,
          incoming.lastPercent,
          incoming.metadata
        );
      }
    }
    if (transfers.channels.get(participantId) === channel) transfers.channels.delete(participantId);
  };
  channel.onclose = () => {
    console.info("WebRTC data channel closed", { participantId, label: channel.label });
    clearChannel();
  };
  channel.onerror = (event) => {
    console.error("WebRTC data channel error", {
      participantId,
      label: channel.label,
      error: event?.error
    });
    clearChannel();
  };
  transfers.channels.set(participantId, channel);
}

export function emitTransferProgress(transfers, participantId, stage, percent, metadata = {}) {
  transfers.onTransferProgress?.({ participantId, stage, percent, metadata });
}

export function createIncomingTransferTimer(transfers, participantId, transferId) {
  return globalThis.setTimeout(() => {
    const transfer = transfers.incomingFiles.get(participantId);
    if (transfer?.metadata.transferId !== transferId) return;
    transfers.incomingFiles.delete(participantId);
    cleanupIncomingTransfer(transfer);
    const channel = transfers.channels.get(participantId);
    if (channel?.readyState === "open")
      sendTransferStatus(channel, {
        type: "file-error",
        transferId,
        error: translateSaved("room.songTransferStopped")
      });
    transfers.emitTransferProgress(participantId, TRANSFER_STAGES.ERROR, 0, transfer.metadata);
  }, TRANSFER_TIMEOUTS.stall);
}
