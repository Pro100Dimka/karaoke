// eslint-disable-next-line import/extensions
import { translateSaved } from "../i18n/runtime.js";

const wait = (delayMs) =>
  new Promise((resolve) => { globalThis.setTimeout(resolve, delayMs); });
const getBinaryChunk = (data) => {
  if (data instanceof ArrayBuffer) return data;
  if (!ArrayBuffer.isView(data)) return null;
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
};
const MAX_INCOMING_FILE_BYTES = 512 * 1024 * 1024;
const MAX_MEMORY_FALLBACK_BYTES = 64 * 1024 * 1024;
const MAX_TRANSFER_ID_LENGTH = 128;
const MAX_FILENAME_LENGTH = 512;
const MAX_INCOMING_CHUNKS = 32_768;
const MAX_DATA_MESSAGE_LENGTH = 16 * 1024;
const TRANSFER_STALL_TIMEOUT_MS = 30_000;
const TRANSFER_CONFIRM_TIMEOUT_MS = 5 * 60_000;
const MAX_PENDING_WRITE_BYTES = 512 * 1024;
const CLOSED_CHANNEL_STATES = ["closing", "closed"];
const isValidTransferSize = (size) =>
  Number.isSafeInteger(size) && size >= 0 && size <= MAX_INCOMING_FILE_BYTES;
const isTransferCancelled = (mesh, channel, lifecycleVersion) =>
  lifecycleVersion !== mesh.lifecycleVersion || channel.readyState !== "open";

const createTransferSink = (participantId, metadata) => {
  const getDirectory = globalThis.navigator?.storage?.getDirectory;
  if (typeof getDirectory === "function") return (async () => {
    const root = await getDirectory.call(globalThis.navigator.storage);
    const safeId = `${participantId}-${metadata.transferId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    const name = `advoice-transfer-${safeId}.part`;
    const handle = await root.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    let closed = false;
    return {
      write: (chunk) => writable.write(chunk),
      finish: async () => {
        if (!closed) { closed = true; await writable.close(); }
        return handle.getFile();
      },
      cleanup: async () => {
        if (!closed) { closed = true; await writable.abort?.().catch?.(() => {}); }
        await root.removeEntry(name).catch(() => {});
      }
    };
  })();
  if (metadata.size > MAX_MEMORY_FALLBACK_BYTES)
    throw new Error(translateSaved("Для большого файла требуется дисковое хранилище браузера"));
  const chunks = [];
  return {
    write: (chunk) => chunks.push(chunk),
    finish: () => new globalThis.Blob(chunks, { type: metadata.mimeType }),
    cleanup: async () => { chunks.length = 0; }
  };
};


export function cancelOutboundTransfers(mesh, participantId, channel, error = new Error(translateSaved("Канал передачи песни закрыт"))) {
  const matches = (entry) => (!participantId || entry.participantId === participantId) && (!channel || entry.channel === channel);
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

export const cleanupIncomingTransfer = (transfer) => {
  if (!transfer) return;
  if (transfer.timer) globalThis.clearTimeout(transfer.timer);
  Promise.resolve(transfer.sink).then((sink) => sink.cleanup()).catch(() => {});
};

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
    if (!pending || pending.participantId !== participantId || pending.channel !== channel) continue;
    store.delete(message.transferId);
    globalThis.clearTimeout(pending.timer);
    pending.reject(error);
    return;
  }
}

function handleFileCredit(mesh, participantId, channel, message) {
  const flow = mesh.pendingTransferCredits.get(message.transferId);
  const bytes = Number(message.bytes);
  if (!flow || flow.participantId !== participantId || flow.channel !== channel || !Number.isFinite(bytes) || bytes <= 0) return;
  flow.available = Math.min(MAX_PENDING_WRITE_BYTES, flow.available + bytes);
  while (flow.waiters.length && flow.available >= flow.waiters[0].bytes) {
    const waiter = flow.waiters.shift();
    flow.available -= waiter.bytes;
    globalThis.clearTimeout(waiter.timer);
    waiter.resolve();
  }
}

function handleTransferConfirmation(mesh, participantId, channel, message) {
  if (message.type === "file-error") return rejectPendingTransfer(mesh, participantId, channel, message);
  const store = message.type === "file-ready" ? mesh.pendingTransferAdmissions : mesh.pendingTransferConfirmations;
  const pending = store.get(message.transferId);
  if (!pending || pending.participantId !== participantId || pending.channel !== channel) return;
  store.delete(message.transferId);
  globalThis.clearTimeout(pending.timer);
  pending.resolve(message);
}

function normalizeTransferMetadata(message) {
  const transferId =
    typeof message.transferId === "string" ? message.transferId : "";
  if (
    !transferId ||
    transferId.length > MAX_TRANSFER_ID_LENGTH ||
    !isValidTransferSize(message.size)
  ) {
    return null;
  }
  return {
    type: "file-start",
    kind:
      typeof message.kind === "string" ? message.kind.slice(0, 64) : undefined,
    songId:
      typeof message.songId === "string"
        ? message.songId.slice(0, 128)
        : undefined,
    commandId:
      typeof message.commandId === "string"
        ? message.commandId.slice(0, 128)
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
}

function handleFileStart(mesh, participantId, channel, message) {
  const metadata = normalizeTransferMetadata(message);
  if (!metadata) return;
  if (mesh.incomingFiles.has(participantId) || mesh.incomingFileAdmissions.has(participantId)) {
    sendTransferStatus(channel, { type: "file-error", transferId: metadata.transferId, error: translateSaved("Получатель уже принимает другой файл") });
    return;
  }
  const reject = (error) => sendTransferStatus(channel, {
    type: "file-error", transferId: metadata.transferId,
    error: error instanceof Error ? error.message : String(error)
  });
  const admission = { channel, transferId: metadata.transferId, cancelled: false };
  const accept = (sink) => {
    if (admission.cancelled || channel.readyState !== "open" || mesh.channels.get(participantId) !== channel || mesh.incomingFiles.has(participantId)) {
      void sink.cleanup();
      throw new Error(translateSaved("Передача файла больше не может быть принята"));
    }
    mesh.incomingFiles.set(participantId, {
      metadata, channel, chunkCount: 0, received: 0, lastPercent: -1, sink, writes: Promise.resolve(),
      timer: mesh.createIncomingTransferTimer(participantId, metadata.transferId)
    });
    mesh.emitTransferProgress(participantId, "receiving", 0, metadata);
    sendTransferStatus(channel, { type: "file-ready", transferId: metadata.transferId, windowBytes: MAX_PENDING_WRITE_BYTES });
  };
  try {
    const accepted = mesh.canAcceptFile?.(participantId, metadata) ?? true;
    if (accepted?.then) {
      mesh.incomingFileAdmissions.set(participantId, admission);
      Promise.resolve(accepted)
        .then((value) => {
          if (value !== true) throw new Error(translateSaved("Получение файла отклонено"));
          if (admission.cancelled) throw new Error(translateSaved("Передача файла больше не может быть принята"));
          return createTransferSink(participantId, metadata);
        })
        .then(accept).catch(reject)
        .finally(() => { if (mesh.incomingFileAdmissions.get(participantId) === admission) mesh.incomingFileAdmissions.delete(participantId); });
      return;
    }
    if (accepted !== true) throw new Error(translateSaved("Получение файла отклонено"));
    const sink = createTransferSink(participantId, metadata);
    if (sink?.then) {
      mesh.incomingFileAdmissions.set(participantId, admission);
      Promise.resolve(sink).then(accept).catch(reject)
        .finally(() => { if (mesh.incomingFileAdmissions.get(participantId) === admission) mesh.incomingFileAdmissions.delete(participantId); });
    } else accept(sink);
  } catch (error) {
    reject(error);
  }
}

function sendTransferStatus(channel, payload) {
  if (channel.readyState === "open") channel.send(JSON.stringify(payload));
}

function handleFileEnd(mesh, participantId, channel, message) {
  const transfer = mesh.incomingFiles.get(participantId);
  mesh.incomingFiles.delete(participantId);
  if (transfer?.timer) globalThis.clearTimeout(transfer.timer);
  if (
    !transfer ||
    transfer.metadata.transferId !== message.transferId ||
    transfer.received !== transfer.metadata.size
  ) {
    cleanupIncomingTransfer(transfer);
    sendTransferStatus(channel, {
      type: "file-error",
      transferId: message.transferId,
      error: translateSaved("Получен неполный файл песни")
    });
    return;
  }

  Promise.resolve(transfer.writes)
    .then(async () => {
      if (transfer.writeError) throw transfer.writeError;
      const file = await transfer.sink.finish();
      mesh.emitTransferProgress(participantId, "importing", 100, transfer.metadata);
      const accepted = await mesh.onFile?.(participantId, file, transfer.metadata);
      if (accepted !== true) throw new Error(translateSaved("Полученный файл не был принят"));
    })
    .then(() => {
      sendTransferStatus(channel, { type: "file-complete", transferId: message.transferId });
      mesh.emitTransferProgress(participantId, "complete", 100, transfer.metadata);
    })
    .catch((error) => {
      sendTransferStatus(channel, {
        type: "file-error",
        transferId: message.transferId,
        error: error instanceof Error ? error.message : String(error)
      });
      mesh.emitTransferProgress(participantId, "error", 100, transfer.metadata);
    })
    .finally(() => cleanupIncomingTransfer(transfer));
}

const DATA_MESSAGE_HANDLERS = {
  "file-ready": handleTransferConfirmation,
  "file-complete": handleTransferConfirmation,
  "file-error": handleTransferConfirmation,
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
  const transfer = mesh.incomingFiles.get(participantId);
  const chunk = getBinaryChunk(data);
  if (!transfer || !chunk || chunk.byteLength === 0) return;
  if (
    transfer.chunkCount >= MAX_INCOMING_CHUNKS ||
    transfer.received + chunk.byteLength > transfer.metadata.size
  ) {
    cleanupIncomingTransfer(transfer);
    mesh.incomingFiles.delete(participantId);
    return;
  }

  transfer.received += chunk.byteLength;
  transfer.chunkCount += 1;
  transfer.writes = transfer.writes
    .then(async () => {
      await transfer.sink.write(chunk);
      sendTransferStatus(channel, {
        type: "file-credit", transferId: transfer.metadata.transferId, bytes: chunk.byteLength
      });
    })
    .catch((error) => {
      if (transfer.writeError) return;
      transfer.writeError = error;
      if (mesh.incomingFiles.get(participantId) === transfer) mesh.incomingFiles.delete(participantId);
      cleanupIncomingTransfer(transfer);
      sendTransferStatus(channel, {
        type: "file-error",
        transferId: transfer.metadata.transferId,
        error: error instanceof Error ? error.message : String(error)
      });
      mesh.emitTransferProgress(participantId, "error", transfer.lastPercent, transfer.metadata);
    });
  globalThis.clearTimeout(transfer.timer);
  transfer.timer = mesh.createIncomingTransferTimer( participantId, transfer.metadata.transferId
  );
  const percent = Math.min( 99, Math.floor((transfer.received / transfer.metadata.size) * 100)
  );
  if (percent === transfer.lastPercent) return;
  transfer.lastPercent = percent;
  mesh.emitTransferProgress(participantId, "receiving", percent, transfer.metadata);
}

export function setupDataChannel(mesh, participantId, channel) {
  const previousChannel = mesh.channels.get(participantId);
  if (previousChannel && previousChannel !== channel) {
    cancelOutboundTransfers(mesh, participantId, previousChannel);
    const admission = mesh.incomingFileAdmissions.get(participantId);
    if (admission?.channel === previousChannel) { admission.cancelled = true; mesh.incomingFileAdmissions.delete(participantId); }
    const incoming = mesh.incomingFiles.get(participantId);
    if (incoming?.channel === previousChannel) { cleanupIncomingTransfer(incoming); mesh.incomingFiles.delete(participantId); }
    if (previousChannel.readyState !== "closed") previousChannel.close?.();
  }

  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = 256 * 1024;
  channel.onmessage = ({ data }) => {
    if (typeof data === "string") {
      handleStringMessage(mesh, participantId, channel, data);
      return;
    }
    handleBinaryChunk(mesh, participantId, channel, data);
  };

  const clearChannel = () => {
    cancelOutboundTransfers(mesh, participantId, channel);
    const admission = mesh.incomingFileAdmissions.get(participantId);
    if (admission?.channel === channel) { admission.cancelled = true; mesh.incomingFileAdmissions.delete(participantId); }
    const incoming = mesh.incomingFiles.get(participantId);
    if (incoming?.channel === channel) { cleanupIncomingTransfer(incoming); mesh.incomingFiles.delete(participantId); }
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

export async function waitForDataChannel(
  mesh,
  participantId,
  timeoutMs = 15_000,
  lifecycleVersion = mesh.lifecycleVersion
) {
  const safeTimeout = Number.isFinite(Number(timeoutMs))
    ? Math.max(0, Math.min(60_000, Number(timeoutMs)))
    : 15_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < safeTimeout) {
    if (lifecycleVersion !== mesh.lifecycleVersion) {
      throw new Error(translateSaved("Передача файла отменена"));
    }
    const channel = mesh.channels.get(participantId);
    if (channel?.readyState === "open") return channel;
    if (CLOSED_CHANNEL_STATES.includes(channel?.readyState)) {
      if (mesh.channels.get(participantId) === channel)
        mesh.channels.delete(participantId);
    }
    if (!mesh.channels.get(participantId) && mesh.peers.has(participantId)) {
      // Re-negotiate a fresh ordered channel after a transient close instead
      // of making the user retry the whole room/song transfer manually.
      // eslint-disable-next-line no-await-in-loop
      await mesh.invite(participantId).catch(() => false);
    }
    // Polling is intentionally sequential.
    // eslint-disable-next-line no-await-in-loop
    await wait(50);
  }
  throw new Error(translateSaved("Канал передачи песни не готов"));
}

export async function sendFile(mesh, participantId, blob, metadata = {}) {
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
    throw new RangeError( translateSaved("Файл слишком большой для передачи через комнату")
    );
  }
  const { lifecycleVersion } = mesh;
  const channel = await mesh.waitForDataChannel( participantId, 15_000, lifecycleVersion
  );
  const transferId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  if (channel.readyState !== "open") throw new Error(translateSaved("Канал передачи песни закрыт"));
  const admission = new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      mesh.pendingTransferAdmissions.delete(transferId);
      reject(new Error(translateSaved("Получатель не подтвердил готовность принять песню")));
    }, 15_000);
    mesh.pendingTransferAdmissions.set(transferId, { participantId, channel, resolve, reject, timer });
  });
  try {
    channel.send(JSON.stringify({
      type: "file-start", transferId, size: blob.size,
      kind: typeof metadata?.kind === "string" ? metadata.kind.slice(0, 64) : undefined,
      songId: typeof metadata?.songId === "string" ? metadata.songId.slice(0, 128) : undefined,
      commandId: typeof metadata?.commandId === "string" ? metadata.commandId.slice(0, 128) : undefined,
      filename: typeof metadata?.filename === "string" ? metadata.filename.slice(0, MAX_FILENAME_LENGTH) : undefined,
      mimeType: (blob.type || "application/octet-stream").slice(0, 255)
    }));
  } catch (error) {
    const pending = mesh.pendingTransferAdmissions.get(transferId);
    if (pending) globalThis.clearTimeout(pending.timer);
    mesh.pendingTransferAdmissions.delete(transferId);
    throw error;
  }
  const ready = await admission;
  const windowBytes = Number(ready?.windowBytes);
  mesh.pendingTransferCredits.set(transferId, {
    participantId, channel,
    available: Number.isFinite(windowBytes) && windowBytes > 0
      ? Math.min(MAX_PENDING_WRITE_BYTES, windowBytes)
      : MAX_PENDING_WRITE_BYTES,
    waiters: []
  });
  try {
    if (isTransferCancelled(mesh, channel, lifecycleVersion))
      throw new Error(translateSaved("Передача файла отменена"));
    mesh.emitTransferProgress(participantId, "sending", 0, metadata);
  const chunkSize = 32 * 1024;
  let lastProgressAt = Date.now();
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    while (channel.bufferedAmount > 512 * 1024) {
      if (isTransferCancelled(mesh, channel, lifecycleVersion)) {
        throw new Error(translateSaved("Передача файла отменена"));
      }
      if (Date.now() - lastProgressAt > TRANSFER_STALL_TIMEOUT_MS) {
        throw new Error( translateSaved( "Передача песни остановилась: нет ответа от участника" )
        );
      }
      // Backpressure must be checked before each ordered chunk.
      // eslint-disable-next-line no-await-in-loop
      await wait(20);
    }
    if (isTransferCancelled(mesh, channel, lifecycleVersion)) {
      throw new Error(translateSaved("Передача файла отменена"));
    }
    // Preserve chunk order on the RTC data channel.
    // eslint-disable-next-line no-await-in-loop
    const chunk = await blob.slice(offset, offset + chunkSize).arrayBuffer();
    if (isTransferCancelled(mesh, channel, lifecycleVersion)) {
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
    if (isTransferCancelled(mesh, channel, lifecycleVersion))
      throw new Error(translateSaved("Передача файла отменена"));
    channel.send(chunk);
    lastProgressAt = Date.now();
    mesh.emitTransferProgress(
      participantId,
      "sending",
      Math.min( 99, Math.floor( (Math.min(offset + chunkSize, blob.size) / blob.size) * 100 )
      ),
      metadata
    );
  }
  if (isTransferCancelled(mesh, channel, lifecycleVersion)) {
    throw new Error(translateSaved("Передача файла отменена"));
  }
  await new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      mesh.pendingTransferConfirmations.delete(transferId);
      reject( new Error(translateSaved("Участник не подтвердил получение песни"))
      );
    }, TRANSFER_CONFIRM_TIMEOUT_MS);
    mesh.pendingTransferConfirmations.set(transferId, { participantId, channel, resolve, reject, timer });
    try {
      channel.send( JSON.stringify({ type: "file-end", transferId })
      );
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
  }
}
