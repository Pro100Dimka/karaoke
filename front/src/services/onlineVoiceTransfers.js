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
const CLOSED_CHANNEL_STATES = ["closing", "closed"];
const isValidTransferSize = (size) =>
  Number.isSafeInteger(size) && size >= 0 && size <= MAX_INCOMING_FILE_BYTES;
const isTransferCancelled = (mesh, channel, lifecycleVersion) =>
  lifecycleVersion !== mesh.lifecycleVersion || channel.readyState !== "open";

const createTransferSink = async (participantId, metadata) => {
  const getDirectory = globalThis.navigator?.storage?.getDirectory;
  if (typeof getDirectory === "function") {
    const root = await getDirectory.call(globalThis.navigator.storage);
    const safeId = `${participantId}-${metadata.transferId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    const name = `advoice-transfer-${safeId}.part`;
    const handle = await root.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    let closed = false;
    return {
      write: (chunk) => writable.write(chunk),
      finish: async () => {
        if (!closed) {
          closed = true;
          await writable.close();
        }
        return handle.getFile();
      },
      cleanup: async () => {
        if (!closed) {
          closed = true;
          await writable.abort?.().catch?.(() => {});
        }
        await root.removeEntry(name).catch(() => {});
      }
    };
  }

  if (metadata.size > MAX_MEMORY_FALLBACK_BYTES)
    throw new Error(translateSaved("Для большого файла требуется дисковое хранилище браузера"));
  const chunks = [];
  return {
    write: (chunk) => chunks.push(chunk),
    finish: () => new globalThis.Blob(chunks, { type: metadata.mimeType }),
    cleanup: async () => {
      chunks.length = 0;
    }
  };
};

const cleanupIncomingTransfer = (transfer) => {
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

function handleTransferConfirmation(mesh, participantId, _channel, message) {
  const pending = mesh.pendingTransferConfirmations.get(message.transferId);
  if (!pending || pending.participantId !== participantId) return;

  mesh.pendingTransferConfirmations.delete(message.transferId);
  globalThis.clearTimeout(pending.timer);
  if (message.type === "file-complete") {
    pending.resolve();
    return;
  }
  pending.reject(
    new Error(
      typeof message.error === "string" && message.error
        ? message.error.slice(0, 500)
        : translateSaved("Получатель не смог импортировать песню")
    )
  );
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

function handleFileStart(mesh, participantId, _channel, message) {
  if (mesh.incomingFiles.has(participantId)) return;
  const metadata = normalizeTransferMetadata(message);
  if (!metadata) return;
  mesh.incomingFiles.set(participantId, {
    metadata,
    chunks: [],
    received: 0,
    lastPercent: -1,
    sink: createTransferSink(participantId, metadata),
    writes: Promise.resolve(),
    timer: mesh.createIncomingTransferTimer(participantId, metadata.transferId)
  });
  mesh.emitTransferProgress(participantId, "receiving", 0, metadata);
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
      const sink = await transfer.sink;
      const file = await sink.finish();
      mesh.emitTransferProgress(participantId, "importing", 100, transfer.metadata);
      await mesh.onFile?.(participantId, file, transfer.metadata);
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
  "file-complete": handleTransferConfirmation,
  "file-error": handleTransferConfirmation,
  "file-start": handleFileStart,
  "file-end": handleFileEnd
};

function handleStringMessage(mesh, participantId, channel, data) {
  const message = parseDataMessage(data);
  if (Object.hasOwn(DATA_MESSAGE_HANDLERS, message?.type)) {
    DATA_MESSAGE_HANDLERS[message.type](mesh, participantId, channel, message);
  }
}

function handleBinaryChunk(mesh, participantId, data) {
  const transfer = mesh.incomingFiles.get(participantId);
  const chunk = getBinaryChunk(data);
  if (!transfer || !chunk || chunk.byteLength === 0) return;
  if (
    transfer.chunks.length >= MAX_INCOMING_CHUNKS ||
    transfer.received + chunk.byteLength > transfer.metadata.size
  ) {
    cleanupIncomingTransfer(transfer);
    mesh.incomingFiles.delete(participantId);
    return;
  }

  transfer.received += chunk.byteLength;
  transfer.chunks.push(null);
  transfer.writes = transfer.writes
    .then(async () => (await transfer.sink).write(chunk))
    .catch((error) => { transfer.writeError ||= error; });
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
    const incoming = mesh.incomingFiles.get(participantId);
    cleanupIncomingTransfer(incoming);
    mesh.incomingFiles.delete(participantId);
    if (previousChannel.readyState !== "closed") previousChannel.close?.();
  }

  channel.binaryType = "arraybuffer";
  channel.bufferedAmountLowThreshold = 256 * 1024;
  channel.onmessage = ({ data }) => {
    if (typeof data === "string") {
      handleStringMessage(mesh, participantId, channel, data);
      return;
    }
    handleBinaryChunk(mesh, participantId, data);
  };

  const clearChannel = () => {
    if (mesh.channels.get(participantId) !== channel) return;
    mesh.channels.delete(participantId);
    const incoming = mesh.incomingFiles.get(participantId);
    cleanupIncomingTransfer(incoming);
    mesh.incomingFiles.delete(participantId);
    for (const [transferId, pending] of mesh.pendingTransferConfirmations) {
      if (pending.participantId !== participantId) continue;
      globalThis.clearTimeout(pending.timer);
      mesh.pendingTransferConfirmations.delete(transferId);
      pending.reject(new Error(translateSaved("Канал передачи песни закрыт")));
    }
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
    mesh.pendingTransferConfirmations.set(transferId, { participantId, resolve, reject, timer });
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
}
