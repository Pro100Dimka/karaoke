// eslint-disable-next-line import/extensions
import { translateSaved } from "../i18n/runtime";
import {
  cancelOutboundTransferById,
  sendTransferStatus,
  TRANSFER_LIMITS,
  TRANSFER_TIMEOUTS
} from "./onlineVoiceTransferProtocol";
import { cleanupIncomingTransfer, createTransferSink } from "./onlineVoiceTransferStorage";

export { sendFile, waitForDataChannel } from "./onlineVoiceTransferOutbound";

const getBinaryChunk = (data) => {
  if (data instanceof ArrayBuffer) return data;
  if (!ArrayBuffer.isView(data)) return null;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
};
const isValidTransferSize = (size) =>
  Number.isSafeInteger(size) && size >= 0 && size <= TRANSFER_LIMITS.fileBytes;

export function cancelOutboundTransfers(
  mesh,
  participantId,
  channel,
  error = new Error(translateSaved("Канал передачи песни закрыт"))
) {
  const matches = (entry) =>
    (!participantId || entry.participantId === participantId) &&
    (!channel || entry.channel === channel);
  const transfers = new Set();
  for (const store of [
    mesh.pendingTransferAdmissions,
    mesh.pendingTransferConfirmations,
    mesh.pendingTransferCredits
  ])
    for (const [transferId, pending] of store) if (matches(pending)) transfers.add(transferId);
  transfers.forEach((transferId) => cancelOutboundTransferById(mesh, transferId, error));
}

function cancelIncomingByTransferId(mesh, participantId, channel, transferId) {
  const admission = mesh.incomingFileAdmissions.get(participantId);
  if (admission?.channel === channel && admission.transferId === transferId) {
    admission.cancelled = true;
    globalThis.clearTimeout(admission.timer);
    mesh.incomingFileAdmissions.delete(participantId);
  }
  const transfer = mesh.incomingFiles.get(participantId);
  if (transfer?.channel === channel && transfer.metadata.transferId === transferId) {
    mesh.incomingFiles.delete(participantId);
    cleanupIncomingTransfer(transfer);
    mesh.emitTransferProgress(participantId, "cancelled", transfer.lastPercent, transfer.metadata);
  }
}

export function cancelTransfersByCommandId(
  mesh,
  commandId,
  error = new Error(translateSaved("Передача файла отменена"))
) {
  if (!commandId) return;
  for (const [transferId, active] of mesh.outboundTransfers) {
    if (active.commandId !== commandId) continue;
    active.cancelled = true;
    active.controller?.abort?.();
    if (active.channel?.readyState === "open")
      sendTransferStatus(active.channel, { type: "file-cancel", transferId });
    cancelOutboundTransferById(mesh, transferId, error);
  }
  for (const [participantId, admission] of mesh.incomingFileAdmissions) {
    if (admission.metadata?.commandId !== commandId) continue;
    cancelIncomingByTransferId(mesh, participantId, admission.channel, admission.transferId);
  }
  for (const [participantId, transfer] of mesh.incomingFiles) {
    if (transfer.metadata?.commandId !== commandId) continue;
    cancelIncomingByTransferId(mesh, participantId, transfer.channel, transfer.metadata.transferId);
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

function rejectPendingTransfer(mesh, participantId, channel, message) {
  const error = new Error(
    typeof message.error === "string" && message.error
      ? message.error.slice(0, 500)
      : translateSaved("Получатель не смог принять песню")
  );
  const flow = mesh.pendingTransferCredits.get(message.transferId);
  if (flow?.participantId === participantId && flow.channel === channel) {
    mesh.pendingTransferCredits.delete(message.transferId);
    flow.waiters.forEach((waiter) => {
      globalThis.clearTimeout(waiter.timer);
      waiter.reject(error);
    });
  }
  for (const store of [mesh.pendingTransferAdmissions, mesh.pendingTransferConfirmations]) {
    const pending = store.get(message.transferId);
    if (!pending || pending.participantId !== participantId || pending.channel !== channel)
      continue;
    store.delete(message.transferId);
    globalThis.clearTimeout(pending.timer);
    pending.reject(error);
    return;
  }
}

function handleFileCredit(mesh, participantId, channel, message) {
  const flow = mesh.pendingTransferCredits.get(message.transferId);
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

function handleTransferConfirmation(mesh, participantId, channel, message) {
  if (message.type === "file-error")
    return rejectPendingTransfer(mesh, participantId, channel, message);
  const store =
    message.type === "file-ready"
      ? mesh.pendingTransferAdmissions
      : mesh.pendingTransferConfirmations;
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
  return {
    type: "file-start",
    kind: typeof message.kind === "string" ? message.kind.slice(0, 64) : undefined,
    songId: typeof message.songId === "string" ? message.songId.slice(0, 128) : undefined,
    commandId: typeof message.commandId === "string" ? message.commandId.slice(0, 128) : undefined,
    revision: typeof message.revision === "string" ? message.revision.slice(0, 80) : undefined,
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
}

function handleFileStart(mesh, participantId, channel, message) {
  const metadata = normalizeTransferMetadata(message);
  if (!metadata) return;
  if (mesh.incomingFiles.has(participantId) || mesh.incomingFileAdmissions.has(participantId)) {
    sendTransferStatus(channel, {
      type: "file-error",
      transferId: metadata.transferId,
      error: translateSaved("Получатель уже принимает другой файл")
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
    if (mesh.incomingFileAdmissions.get(participantId) === admission)
      mesh.incomingFileAdmissions.delete(participantId);
  };
  const accept = (sink) => {
    finishAdmission();
    if (
      admission.cancelled ||
      channel.readyState !== "open" ||
      mesh.channels.get(participantId) !== channel ||
      mesh.incomingFiles.has(participantId)
    ) {
      sink.cleanup();
      throw new Error(translateSaved("Передача файла больше не может быть принята"));
    }
    mesh.incomingFiles.set(participantId, {
      metadata,
      channel,
      phase: "receiving",
      cancelled: false,
      cleanupStarted: false,
      controller:
        typeof globalThis.AbortController === "function" ? new globalThis.AbortController() : null,
      chunkCount: 0,
      received: 0,
      lastPercent: -1,
      chunks: Array.isArray(sink?.chunks) ? sink.chunks : [],
      sink,
      writes: Promise.resolve(),
      timer: mesh.createIncomingTransferTimer(participantId, metadata.transferId)
    });
    mesh.emitTransferProgress(participantId, "receiving", 0, metadata);
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
      throw new Error(translateSaved("Передача файла больше не может быть принята"));
    const sink = createTransferSink(participantId, metadata);
    if (sink && typeof sink.then === "function") {
      Promise.resolve(sink).then(accept).catch(failAdmission);
      return;
    }
    accept(sink);
  };
  const admitAsync = async (accepted) => {
    try {
      if ((await accepted) !== true) throw new Error(translateSaved("Получение файла отклонено"));
      createAndAcceptSink();
    } catch (error) {
      failAdmission(error);
    }
  };
  try {
    const accepted = mesh.canAcceptFile?.(participantId, metadata) ?? true;
    mesh.incomingFileAdmissions.set(participantId, admission);
    admission.timer = globalThis.setTimeout(() => {
      if (mesh.incomingFileAdmissions.get(participantId) !== admission) return;
      admission.cancelled = true;
      mesh.incomingFileAdmissions.delete(participantId);
      reject(new Error(translateSaved("Подготовка хранилища для песни превысила время ожидания")));
    }, TRANSFER_TIMEOUTS.admission);
    if (accepted && typeof accepted.then === "function") admitAsync(accepted);
    else if (accepted === true) createAndAcceptSink();
    else failAdmission(new Error(translateSaved("Получение файла отклонено")));
  } catch (error) {
    failAdmission(error);
  }
}

const currentIncomingTransfer = (mesh, participantId, channel) => {
  const transfer = mesh.incomingFiles.get(participantId);
  return transfer?.channel === channel ? transfer : null;
};

const incomingTransferActive = (mesh, participantId, channel, transfer) =>
  !transfer.cancelled &&
  mesh.incomingFiles.get(participantId) === transfer &&
  transfer.channel === channel;

function rejectIncomingTransfer(mesh, participantId, channel, transfer, error) {
  if (mesh.incomingFiles.get(participantId) === transfer) mesh.incomingFiles.delete(participantId);
  transfer.phase = "failed";
  cleanupIncomingTransfer(transfer);
  sendTransferStatus(channel, {
    type: "file-error",
    transferId: transfer.metadata.transferId,
    error
  });
  mesh.emitTransferProgress(participantId, "error", transfer.lastPercent, transfer.metadata);
}

function handleFileEnd(mesh, participantId, channel, message) {
  const transfer = currentIncomingTransfer(mesh, participantId, channel);
  if (!transfer) {
    if (typeof message.transferId === "string")
      sendTransferStatus(channel, {
        type: "file-error",
        transferId: message.transferId,
        error: translateSaved("Получен неполный файл песни")
      });
    return;
  }
  if (transfer.phase !== "receiving") return;
  if (transfer.metadata.transferId !== message.transferId) {
    sendTransferStatus(channel, {
      type: "file-error",
      transferId: message.transferId,
      error: translateSaved("Получен неизвестный идентификатор передачи")
    });
    return;
  }
  if (transfer.received !== transfer.metadata.size) {
    rejectIncomingTransfer(
      mesh,
      participantId,
      channel,
      transfer,
      translateSaved("Получен неполный файл песни")
    );
    return;
  }

  transfer.phase = "flushing";
  globalThis.clearTimeout(transfer.timer);
  const cancellation = new Promise((resolve) => {
    transfer.cancelFinalization = resolve;
  });
  const cancelled = () => !incomingTransferActive(mesh, participantId, channel, transfer);
  const ensureActive = () => {
    if (cancelled()) throw new Error(translateSaved("Передача файла отменена"));
  };
  const step = (promise, timeoutMs, timeoutMessage) => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = globalThis.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });
    return Promise.race([
      Promise.resolve(promise),
      cancellation.then(() => {
        throw new Error(translateSaved("Передача файла отменена"));
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
    translateSaved("Запись полученной песни на диск превысила время ожидания")
  )
    .then(async () => {
      if (transfer.writeError) throw transfer.writeError;
      transfer.phase = "finalizing";
      const file = await step(
        transfer.sink.finish(),
        TRANSFER_TIMEOUTS.close,
        translateSaved("Закрытие временного файла песни превысило время ожидания")
      );
      transfer.phase = "importing";
      transfer.lastPercent = 100;
      mesh.emitTransferProgress(participantId, "importing", 100, transfer.metadata);
      const accepted = await step(
        mesh.onFile?.(participantId, file, transfer.metadata, transfer.controller?.signal),
        TRANSFER_TIMEOUTS.import,
        translateSaved("Импорт песни превысил время ожидания")
      );
      if (accepted !== true) throw new Error(translateSaved("Полученный файл не был принят"));
    })
    .then(() => {
      if (!incomingTransferActive(mesh, participantId, channel, transfer)) return;
      transfer.phase = "complete";
      mesh.incomingFiles.delete(participantId);
      globalThis.clearTimeout(transfer.timer);
      sendTransferStatus(channel, { type: "file-complete", transferId: message.transferId });
      mesh.emitTransferProgress(participantId, "complete", 100, transfer.metadata);
    })
    .catch((error) => {
      if (transfer.cancelled || mesh.incomingFiles.get(participantId) !== transfer) return;
      rejectIncomingTransfer(
        mesh,
        participantId,
        channel,
        transfer,
        error instanceof Error ? error.message : String(error)
      );
    })
    .finally(() => {
      transfer.cancelFinalization = null;
      if (mesh.incomingFiles.get(participantId) === transfer && transfer.phase === "complete")
        mesh.incomingFiles.delete(participantId);
      cleanupIncomingTransfer(transfer);
    });
}

function handleFileCancel(mesh, participantId, channel, message) {
  if (typeof message.transferId !== "string") return;
  cancelIncomingByTransferId(mesh, participantId, channel, message.transferId);
}

const DATA_MESSAGE_HANDLERS = {
  "file-ready": handleTransferConfirmation,
  "file-complete": handleTransferConfirmation,
  "file-error": handleTransferConfirmation,
  "file-cancel": handleFileCancel,
  "file-credit": handleFileCredit,
  "file-start": handleFileStart,
  "file-end": handleFileEnd
};

function handleStringMessage(mesh, participantId, channel, data) {
  const message = parseDataMessage(data);
  if (Object.hasOwn(DATA_MESSAGE_HANDLERS, message?.type)) {
    DATA_MESSAGE_HANDLERS[message.type](mesh, participantId, channel, message);
  }
}

function handleBinaryChunk(mesh, participantId, channel, data) {
  const transfer = currentIncomingTransfer(mesh, participantId, channel);
  const chunk = getBinaryChunk(data);
  if (!transfer || transfer.phase !== "receiving" || !chunk || chunk.byteLength === 0) return;
  if (
    transfer.chunkCount >= TRANSFER_LIMITS.chunks ||
    transfer.received + chunk.byteLength > transfer.metadata.size
  ) {
    rejectIncomingTransfer(
      mesh,
      participantId,
      channel,
      transfer,
      translateSaved("Получен некорректный размер файла песни")
    );
    return;
  }

  transfer.received += chunk.byteLength;
  transfer.chunkCount += 1;
  transfer.writes = transfer.writes
    .then(async () => {
      if (!incomingTransferActive(mesh, participantId, channel, transfer)) return;
      await transfer.sink.write(chunk);
      if (!incomingTransferActive(mesh, participantId, channel, transfer)) return;
      sendTransferStatus(channel, {
        type: "file-credit",
        transferId: transfer.metadata.transferId,
        bytes: chunk.byteLength
      });
    })
    .catch((error) => {
      if (transfer.writeError || transfer.cancelled) return;
      transfer.writeError = error;
      rejectIncomingTransfer(
        mesh,
        participantId,
        channel,
        transfer,
        error instanceof Error ? error.message : String(error)
      );
    });
  globalThis.clearTimeout(transfer.timer);
  transfer.timer = mesh.createIncomingTransferTimer(participantId, transfer.metadata.transferId);
  const percent = Math.min(99, Math.floor((transfer.received / transfer.metadata.size) * 100));
  if (percent === transfer.lastPercent) return;
  transfer.lastPercent = percent;
  mesh.emitTransferProgress(participantId, "receiving", percent, transfer.metadata);
}

export function setupDataChannel(mesh, participantId, channel) {
  const previousChannel = mesh.channels.get(participantId);

  if (previousChannel && previousChannel !== channel) {
    cancelOutboundTransfers(mesh, participantId, previousChannel);

    const admission = mesh.incomingFileAdmissions.get(participantId);
    if (admission?.channel === previousChannel) {
      admission.cancelled = true;
      globalThis.clearTimeout(admission.timer);
      mesh.incomingFileAdmissions.delete(participantId);
    }

    const incoming = mesh.incomingFiles.get(participantId);
    if (incoming?.channel === previousChannel) {
      incoming.cancelled = true;
      incoming.cancelFinalization?.();
      cleanupIncomingTransfer(incoming);
      mesh.incomingFiles.delete(participantId);
    }

    if (previousChannel.readyState !== "closed") {
      previousChannel.close?.();
    }
  }

  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = 256 * 1024;

  channel.onmessage = ({ data }) => {
    if (mesh.channels.get(participantId) !== channel) return;

    if (typeof data === "string") {
      handleStringMessage(mesh, participantId, channel, data);
      return;
    }

    handleBinaryChunk(mesh, participantId, channel, data);
  };

  const clearChannel = () => {
    if (mesh.channels.get(participantId) !== channel) return;

    cancelOutboundTransfers(mesh, participantId, channel);

    const admission = mesh.incomingFileAdmissions.get(participantId);
    if (admission?.channel === channel) {
      admission.cancelled = true;
      globalThis.clearTimeout(admission.timer);
      mesh.incomingFileAdmissions.delete(participantId);
    }

    const incoming = mesh.incomingFiles.get(participantId);
    if (incoming?.channel === channel) {
      incoming.cancelled = true;
      incoming.cancelFinalization?.();
      cleanupIncomingTransfer(incoming);
      mesh.incomingFiles.delete(participantId);
    }

    mesh.channels.delete(participantId);
  };

  channel.onclose = clearChannel;

  channel.onerror = () => {
    // RTCDataChannel error сам по себе не означает,
    // что участник покинул комнату.
    //
    // Ждём реального `close`.
    if (channel.readyState === "closed") {
      clearChannel();
    }
  };

  mesh.channels.set(participantId, channel);
}

export function emitTransferProgress(mesh, participantId, stage, percent, metadata = {}) {
  mesh.onTransferProgress?.({ participantId, stage, percent, metadata });
}

export function createIncomingTransferTimer(mesh, participantId, transferId) {
  return globalThis.setTimeout(() => {
    const transfer = mesh.incomingFiles.get(participantId);
    if (transfer?.metadata.transferId !== transferId) return;
    mesh.incomingFiles.delete(participantId);
    cleanupIncomingTransfer(transfer);
    const channel = mesh.channels.get(participantId);
    if (channel?.readyState === "open")
      sendTransferStatus(channel, {
        type: "file-error",
        transferId,
        error: translateSaved("Передача песни остановилась")
      });
    mesh.emitTransferProgress(participantId, "error", 0, transfer.metadata);
  }, TRANSFER_TIMEOUTS.stall);
}
