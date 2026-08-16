// eslint-disable-next-line import/extensions
import { translateSaved } from "../i18n/runtime";
import { cleanupIncomingTransfer, createTransferSink } from "./onlineVoiceTransferStorage";

const wait = (delayMs) =>
  new Promise((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
const waitAbortable = (delayMs, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(translateSaved("Передача файла отменена")));
      return;
    }
    const timer = globalThis.setTimeout(done, delayMs);
    function done() {
      signal?.removeEventListener?.("abort", aborted);
      resolve();
    }
    function aborted() {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener?.("abort", aborted);
      reject(new Error(translateSaved("Передача файла отменена")));
    }
    signal?.addEventListener?.("abort", aborted, { once: true });
  });
const getBinaryChunk = (data) => {
  if (data instanceof ArrayBuffer) return data;
  if (!ArrayBuffer.isView(data)) return null;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
};
const MAX_INCOMING_FILE_BYTES = 512 * 1024 * 1024;
const MAX_TRANSFER_ID_LENGTH = 128;
const MAX_FILENAME_LENGTH = 512;
const MAX_INCOMING_CHUNKS = 32_768;
const MAX_DATA_MESSAGE_LENGTH = 16 * 1024;
const TRANSFER_STALL_TIMEOUT_MS = 30_000;
const TRANSFER_ADMISSION_TIMEOUT_MS = 15_000;
const TRANSFER_CONFIRM_TIMEOUT_MS = 5 * 60_000;
const TRANSFER_FLUSH_TIMEOUT_MS = 30_000;
const TRANSFER_CLOSE_TIMEOUT_MS = 30_000;
const TRANSFER_IMPORT_TIMEOUT_MS = 5 * 60_000;
const MAX_PENDING_WRITE_BYTES = 512 * 1024;
const CLOSED_CHANNEL_STATES = ["closing", "closed"];
const isValidTransferSize = (size) =>
  Number.isSafeInteger(size) && size >= 0 && size <= MAX_INCOMING_FILE_BYTES;
const isTransferCancelled = (mesh, channel, lifecycleVersion) =>
  lifecycleVersion !== mesh.lifecycleVersion || channel.readyState !== "open";

export function cancelOutboundTransfers(
  mesh,
  participantId,
  channel,
  error = new Error(translateSaved("Канал передачи песни закрыт"))
) {
  const matches = (entry) =>
    (!participantId || entry.participantId === participantId) &&
    (!channel || entry.channel === channel);
  for (const store of [mesh.pendingTransferAdmissions, mesh.pendingTransferConfirmations]) {
    for (const [transferId, pending] of store) {
      if (!matches(pending)) continue;
      store.delete(transferId);
      globalThis.clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
  for (const [transferId, flow] of mesh.pendingTransferCredits) {
    if (!matches(flow)) continue;
    mesh.pendingTransferCredits.delete(transferId);
    flow.waiters.forEach((waiter) => {
      globalThis.clearTimeout(waiter.timer);
      waiter.reject(error);
    });
  }
}

function cancelOutboundTransferById(mesh, transferId, error) {
  for (const store of [mesh.pendingTransferAdmissions, mesh.pendingTransferConfirmations]) {
    const pending = store.get(transferId);
    if (!pending) continue;
    store.delete(transferId);
    globalThis.clearTimeout(pending.timer);
    pending.reject(error);
  }
  const flow = mesh.pendingTransferCredits.get(transferId);
  if (flow) {
    mesh.pendingTransferCredits.delete(transferId);
    flow.waiters.forEach((waiter) => {
      globalThis.clearTimeout(waiter.timer);
      waiter.reject(error);
    });
  }
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
  if (data.length > MAX_DATA_MESSAGE_LENGTH) return null;
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
  flow.available = Math.min(MAX_PENDING_WRITE_BYTES, flow.available + bytes);
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
    transferId.length > MAX_TRANSFER_ID_LENGTH ||
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
        ? message.filename.slice(0, MAX_FILENAME_LENGTH)
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
      windowBytes: MAX_PENDING_WRITE_BYTES
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
    }, TRANSFER_ADMISSION_TIMEOUT_MS);
    if (accepted && typeof accepted.then === "function") admitAsync(accepted);
    else if (accepted === true) createAndAcceptSink();
    else failAdmission(new Error(translateSaved("Получение файла отклонено")));
  } catch (error) {
    failAdmission(error);
  }
}

function sendTransferStatus(channel, payload) {
  if (channel.readyState !== "open") return false;
  try {
    channel.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
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
    TRANSFER_FLUSH_TIMEOUT_MS,
    translateSaved("Запись полученной песни на диск превысила время ожидания")
  )
    .then(async () => {
      if (transfer.writeError) throw transfer.writeError;
      transfer.phase = "finalizing";
      const file = await step(
        transfer.sink.finish(),
        TRANSFER_CLOSE_TIMEOUT_MS,
        translateSaved("Закрытие временного файла песни превысило время ожидания")
      );
      transfer.phase = "importing";
      mesh.emitTransferProgress(participantId, "importing", 100, transfer.metadata);
      const accepted = await step(
        mesh.onFile?.(participantId, file, transfer.metadata, transfer.controller?.signal),
        TRANSFER_IMPORT_TIMEOUT_MS,
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
    transfer.chunkCount >= MAX_INCOMING_CHUNKS ||
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
      mesh.incomingFileAdmissions.delete(participantId);
    }
    const incoming = mesh.incomingFiles.get(participantId);
    if (incoming?.channel === previousChannel) {
      cleanupIncomingTransfer(incoming);
      mesh.incomingFiles.delete(participantId);
    }
    if (previousChannel.readyState !== "closed") previousChannel.close?.();
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
    cancelOutboundTransfers(mesh, participantId, channel);
    const admission = mesh.incomingFileAdmissions.get(participantId);
    if (admission?.channel === channel) {
      admission.cancelled = true;
      mesh.incomingFileAdmissions.delete(participantId);
    }
    const incoming = mesh.incomingFiles.get(participantId);
    if (incoming?.channel === channel) {
      cleanupIncomingTransfer(incoming);
      mesh.incomingFiles.delete(participantId);
    }
    if (mesh.channels.get(participantId) === channel) mesh.channels.delete(participantId);
  };
  channel.onclose = clearChannel;
  channel.onerror = clearChannel;
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
    if (channel?.readyState === "open") {
      channel.send(
        JSON.stringify({
          type: "file-error",
          transferId,
          error: translateSaved("Передача песни остановилась")
        })
      );
    }
    mesh.emitTransferProgress(participantId, "error", 0, transfer.metadata);
  }, TRANSFER_STALL_TIMEOUT_MS);
}

export async function waitForDataChannel(mesh, participantId, timeoutMs, lifecycleVersion, signal) {
  const resolvedTimeoutMs = timeoutMs ?? 15_000;
  const resolvedLifecycleVersion = lifecycleVersion ?? mesh.lifecycleVersion;
  const safeTimeout = Number.isFinite(Number(resolvedTimeoutMs))
    ? Math.max(0, Math.min(60_000, Number(resolvedTimeoutMs)))
    : 15_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < safeTimeout) {
    if (signal?.aborted) throw new Error(translateSaved("Передача файла отменена"));
    if (resolvedLifecycleVersion !== mesh.lifecycleVersion) {
      throw new Error(translateSaved("Передача файла отменена"));
    }
    const channel = mesh.channels.get(participantId);
    if (channel?.readyState === "open") return channel;
    if (CLOSED_CHANNEL_STATES.includes(channel?.readyState)) {
      if (mesh.channels.get(participantId) === channel) mesh.channels.delete(participantId);
      throw new Error(translateSaved("Канал передачи песни закрыт"));
    }
    if (!mesh.channels.get(participantId) && mesh.peers.has(participantId)) {
      // Re-negotiate a fresh ordered channel after a transient close instead
      // of making the user retry the whole room/song transfer manually.
      // eslint-disable-next-line no-await-in-loop
      await mesh.invite(participantId).catch(() => false);
    }
    // Polling is intentionally sequential.
    // eslint-disable-next-line no-await-in-loop
    await waitAbortable(50, signal);
  }
  if (signal?.aborted) throw new Error(translateSaved("Передача файла отменена"));
  throw new Error(translateSaved("Канал передачи песни не готов"));
}

export async function sendFile(mesh, participantId, blob, metadata = {}, options = {}) {
  const BlobClass = globalThis.Blob;
  if (
    typeof participantId !== "string" ||
    !participantId ||
    participantId.length > 128 ||
    typeof BlobClass !== "function" ||
    !(blob instanceof BlobClass)
  ) {
    throw new TypeError(translateSaved("Для передачи нужны участник и файл"));
  }
  if (blob.size > MAX_INCOMING_FILE_BYTES) {
    throw new RangeError(translateSaved("Файл слишком большой для передачи через комнату"));
  }
  const { lifecycleVersion } = mesh;
  const transferId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const controller =
    typeof globalThis.AbortController === "function" ? new globalThis.AbortController() : null;
  const active = {
    participantId,
    channel: null,
    commandId: metadata?.commandId,
    controller,
    cancelled: false
  };
  mesh.outboundTransfers.set(transferId, active);
  const abort = () => {
    active.cancelled = true;
    controller?.abort?.();
    if (active.channel?.readyState === "open")
      sendTransferStatus(active.channel, { type: "file-cancel", transferId });
    cancelOutboundTransferById(
      mesh,
      transferId,
      new Error(translateSaved("Передача файла отменена"))
    );
  };
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener?.("abort", abort, { once: true });
  let channel;
  try {
    channel = await mesh.waitForDataChannel(
      participantId,
      15_000,
      lifecycleVersion,
      controller?.signal || options.signal
    );
    active.channel = channel;
  } catch (error) {
    mesh.outboundTransfers.delete(transferId);
    options.signal?.removeEventListener?.("abort", abort);
    throw error;
  }
  if (active.cancelled || options.signal?.aborted) {
    mesh.outboundTransfers.delete(transferId);
    options.signal?.removeEventListener?.("abort", abort);
    throw new Error(translateSaved("Передача файла отменена"));
  }
  if (channel.readyState !== "open") throw new Error(translateSaved("Канал передачи песни закрыт"));
  const cancelled = () =>
    active.cancelled ||
    options.signal?.aborted ||
    isTransferCancelled(mesh, channel, lifecycleVersion);
  const admission = new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      mesh.pendingTransferAdmissions.delete(transferId);
      if (channel.readyState === "open")
        sendTransferStatus(channel, { type: "file-cancel", transferId });
      reject(new Error(translateSaved("Получатель не подтвердил готовность принять песню")));
    }, TRANSFER_ADMISSION_TIMEOUT_MS);
    mesh.pendingTransferAdmissions.set(transferId, {
      participantId,
      channel,
      resolve,
      reject,
      timer
    });
  });
  try {
    channel.send(
      JSON.stringify({
        type: "file-start",
        transferId,
        size: blob.size,
        kind: typeof metadata?.kind === "string" ? metadata.kind.slice(0, 64) : undefined,
        songId: typeof metadata?.songId === "string" ? metadata.songId.slice(0, 128) : undefined,
        commandId:
          typeof metadata?.commandId === "string" ? metadata.commandId.slice(0, 128) : undefined,
        revision:
          typeof metadata?.revision === "string" ? metadata.revision.slice(0, 80) : undefined,
        filename:
          typeof metadata?.filename === "string"
            ? metadata.filename.slice(0, MAX_FILENAME_LENGTH)
            : undefined,
        mimeType: (blob.type || "application/octet-stream").slice(0, 255)
      })
    );
  } catch (error) {
    const pending = mesh.pendingTransferAdmissions.get(transferId);
    if (pending) globalThis.clearTimeout(pending.timer);
    mesh.pendingTransferAdmissions.delete(transferId);
    mesh.outboundTransfers.delete(transferId);
    options.signal?.removeEventListener?.("abort", abort);
    throw error;
  }
  let ready;
  try {
    ready = await admission;
  } catch (error) {
    mesh.outboundTransfers.delete(transferId);
    options.signal?.removeEventListener?.("abort", abort);
    throw error;
  }
  const windowBytes = Number(ready?.windowBytes);
  mesh.pendingTransferCredits.set(transferId, {
    participantId,
    channel,
    available:
      Number.isFinite(windowBytes) && windowBytes > 0
        ? Math.min(MAX_PENDING_WRITE_BYTES, windowBytes)
        : MAX_PENDING_WRITE_BYTES,
    waiters: []
  });
  try {
    if (cancelled()) throw new Error(translateSaved("Передача файла отменена"));
    mesh.emitTransferProgress(participantId, "sending", 0, metadata);
    const chunkSize = 32 * 1024;
    let lastProgressAt = Date.now();
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      while (channel.bufferedAmount > 512 * 1024) {
        if (cancelled()) {
          throw new Error(translateSaved("Передача файла отменена"));
        }
        if (Date.now() - lastProgressAt > TRANSFER_STALL_TIMEOUT_MS) {
          throw new Error(translateSaved("Передача песни остановилась: нет ответа от участника"));
        }
        // Backpressure must be checked before each ordered chunk.
        // eslint-disable-next-line no-await-in-loop
        await wait(20);
      }
      if (cancelled()) {
        throw new Error(translateSaved("Передача файла отменена"));
      }
      // Preserve chunk order on the RTC data channel.
      // eslint-disable-next-line no-await-in-loop
      const chunk = await blob.slice(offset, offset + chunkSize).arrayBuffer();
      if (cancelled()) {
        throw new Error(translateSaved("Передача файла отменена"));
      }
      const flow = mesh.pendingTransferCredits.get(transferId);
      if (!flow) throw new Error(translateSaved("Передача файла отменена"));
      if (flow.available >= chunk.byteLength) flow.available -= chunk.byteLength;
      else {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve, reject) => {
          const waiter = { bytes: chunk.byteLength, resolve, reject, timer: null };
          waiter.timer = globalThis.setTimeout(() => {
            const index = flow.waiters.indexOf(waiter);
            if (index >= 0) flow.waiters.splice(index, 1);
            reject(new Error(translateSaved("Получатель слишком медленно сохраняет песню")));
          }, TRANSFER_STALL_TIMEOUT_MS);
          flow.waiters.push(waiter);
        });
      }
      if (cancelled()) throw new Error(translateSaved("Передача файла отменена"));
      channel.send(chunk);
      lastProgressAt = Date.now();
      mesh.emitTransferProgress(
        participantId,
        "sending",
        Math.min(99, Math.floor((Math.min(offset + chunkSize, blob.size) / blob.size) * 100)),
        metadata
      );
    }
    if (cancelled()) {
      throw new Error(translateSaved("Передача файла отменена"));
    }
    await new Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        mesh.pendingTransferConfirmations.delete(transferId);
        reject(new Error(translateSaved("Участник не подтвердил получение песни")));
      }, TRANSFER_CONFIRM_TIMEOUT_MS);
      mesh.pendingTransferConfirmations.set(transferId, {
        participantId,
        channel,
        resolve,
        reject,
        timer
      });
      try {
        channel.send(JSON.stringify({ type: "file-end", transferId }));
      } catch (error) {
        globalThis.clearTimeout(timer);
        mesh.pendingTransferConfirmations.delete(transferId);
        reject(error);
      }
    });
    mesh.emitTransferProgress(participantId, "complete", 100, metadata);
  } finally {
    const flow = mesh.pendingTransferCredits.get(transferId);
    if (flow) {
      const error = new Error(translateSaved("Передача файла завершена"));
      flow.waiters.forEach((waiter) => {
        globalThis.clearTimeout(waiter.timer);
        waiter.reject(error);
      });
    }
    mesh.pendingTransferCredits.delete(transferId);
    mesh.outboundTransfers.delete(transferId);
    options.signal?.removeEventListener?.("abort", abort);
  }
}
