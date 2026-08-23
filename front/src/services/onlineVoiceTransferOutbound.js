import { translateSaved } from "../i18n/runtime";
import { generateId } from "../utils/id";
import {
  cancelOutboundTransferById,
  sendTransferStatus,
  TRANSFER_LIMITS,
  TRANSFER_TIMEOUTS,
  wait,
  waitAbortable
} from "./onlineVoiceTransferProtocol";

const CLOSED = new Set(["closing", "closed"]);
const STALE_CONNECTING_MS = 8_000;
const cancelledError = () => new Error(translateSaved("Передача файла отменена"));
const isCancelled = (mesh, channel, lifecycle, active, signal) =>
  active.cancelled ||
  signal?.aborted ||
  lifecycle !== mesh.lifecycleVersion ||
  channel.readyState !== "open";

export async function waitForDataChannel(mesh, participantId, timeoutMs, lifecycleVersion, signal) {
  const lifecycle = lifecycleVersion ?? mesh.lifecycleVersion;
  const numericTimeout = Number(timeoutMs ?? 15_000);
  const timeout = Number.isFinite(numericTimeout)
    ? Math.max(0, Math.min(60_000, numericTimeout))
    : 15_000;
  const startedAt = Date.now();
  let connectingSince = null;
  while (Date.now() - startedAt < timeout) {
    if (signal?.aborted || lifecycle !== mesh.lifecycleVersion) throw cancelledError();
    const channel = mesh.channels.get(participantId);
    if (channel?.readyState === "open") return channel;
    if (CLOSED.has(channel?.readyState)) {
      if (mesh.channels.get(participantId) === channel) mesh.channels.delete(participantId);
      if (!mesh.peers.has(participantId))
        throw new Error(translateSaved("Канал передачи песни закрыт"));
      connectingSince = null;
    } else if (channel?.readyState === "connecting") {
      connectingSince ??= Date.now();
      if (Date.now() - connectingSince >= STALE_CONNECTING_MS) {
        // A failed SDP negotiation can leave a channel stuck in `connecting` forever.
        // Drop only that unopened channel and renegotiate; never touch an open transfer.
        if (mesh.channels.get(participantId) === channel) {
          mesh.channels.delete(participantId);
          channel.close?.();
        }
        connectingSince = null;
      }
    } else {
      connectingSince = null;
    }

    if (!mesh.channels.get(participantId) && mesh.peers.has(participantId)) {
      // eslint-disable-next-line no-await-in-loop
      await mesh.invite(participantId).catch(() => false);
    }
    // eslint-disable-next-line no-await-in-loop
    await waitAbortable(50, signal);
  }
  if (signal?.aborted) throw cancelledError();
  throw new Error(translateSaved("Канал передачи песни не готов"));
}

const transferMetadata = (transferId, blob, metadata) => ({
  type: "file-start",
  transferId,
  size: blob.size,
  kind: typeof metadata?.kind === "string" ? metadata.kind.slice(0, 64) : undefined,
  songId: typeof metadata?.songId === "string" ? metadata.songId.slice(0, 128) : undefined,
  commandId: typeof metadata?.commandId === "string" ? metadata.commandId.slice(0, 128) : undefined,
  revision: typeof metadata?.revision === "string" ? metadata.revision.slice(0, 80) : undefined,
  filename:
    typeof metadata?.filename === "string"
      ? metadata.filename.slice(0, TRANSFER_LIMITS.filename)
      : undefined,
  mimeType: (blob.type || "application/octet-stream").slice(0, 255)
});

function createPending(mesh, store, transferId, participantId, channel, timeout, message) {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      store.delete(transferId);
      reject(new Error(translateSaved(message)));
    }, timeout);
    store.set(transferId, { participantId, channel, resolve, reject, timer });
  });
}

async function reserveCredit(mesh, transferId, bytes) {
  const flow = mesh.pendingTransferCredits.get(transferId);
  if (!flow) throw cancelledError();
  if (flow.available >= bytes) {
    flow.available -= bytes;
    return;
  }
  await new Promise((resolve, reject) => {
    const waiter = { bytes, resolve, reject, timer: null };
    waiter.timer = globalThis.setTimeout(() => {
      const index = flow.waiters.indexOf(waiter);
      if (index >= 0) flow.waiters.splice(index, 1);
      reject(new Error(translateSaved("Получатель слишком медленно сохраняет песню")));
    }, TRANSFER_TIMEOUTS.stall);
    flow.waiters.push(waiter);
  });
}

async function streamFile(mesh, transfer, blob, metadata, signal) {
  const { active, channel, lifecycle, participantId, transferId } = transfer;
  const cancelled = () => isCancelled(mesh, channel, lifecycle, active, signal);
  mesh.emitTransferProgress(participantId, "sending", 0, metadata);
  const chunkSize = 32 * 1024;
  let lastProgressAt = Date.now();
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    while (channel.bufferedAmount > 512 * 1024) {
      if (cancelled()) throw cancelledError();
      if (Date.now() - lastProgressAt > TRANSFER_TIMEOUTS.stall)
        throw new Error(translateSaved("Передача песни остановилась: нет ответа от участника"));
      // eslint-disable-next-line no-await-in-loop
      await wait(20);
    }
    if (cancelled()) throw cancelledError();
    // eslint-disable-next-line no-await-in-loop
    const chunk = await blob.slice(offset, offset + chunkSize).arrayBuffer();
    if (cancelled()) throw cancelledError();
    // eslint-disable-next-line no-await-in-loop
    await reserveCredit(mesh, transferId, chunk.byteLength);
    if (cancelled()) throw cancelledError();
    channel.send(chunk);
    lastProgressAt = Date.now();
    mesh.emitTransferProgress(
      participantId,
      "sending",
      Math.min(99, Math.floor((Math.min(offset + chunkSize, blob.size) / blob.size) * 100)),
      metadata
    );
  }
}

export async function sendFile(mesh, participantId, blob, metadata = {}, options = {}) {
  const BlobClass = globalThis.Blob;
  if (
    typeof participantId !== "string" ||
    !participantId ||
    participantId.length > 128 ||
    typeof BlobClass !== "function" ||
    !(blob instanceof BlobClass)
  )
    throw new TypeError(translateSaved("Для передачи нужны участник и файл"));
  if (blob.size > TRANSFER_LIMITS.fileBytes)
    throw new RangeError(translateSaved("Файл слишком большой для передачи через комнату"));

  const lifecycle = mesh.lifecycleVersion;
  const transferId = generateId();
  const controller = typeof AbortController === "function" ? new AbortController() : null;
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
    cancelOutboundTransferById(mesh, transferId, cancelledError());
  };
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener?.("abort", abort, { once: true });

  let channel;
  let admission;
  let confirmation;
  try {
    channel = await mesh.waitForDataChannel(
      participantId,
      15_000,
      lifecycle,
      controller?.signal || options.signal
    );
    active.channel = channel;
    if (channel.readyState !== "open")
      throw new Error(translateSaved("Канал передачи песни закрыт"));
    if (isCancelled(mesh, channel, lifecycle, active, options.signal)) throw cancelledError();
    admission = createPending(
      mesh,
      mesh.pendingTransferAdmissions,
      transferId,
      participantId,
      channel,
      TRANSFER_TIMEOUTS.admission,
      "Получатель не подтвердил готовность принять песню"
    );
    channel.send(JSON.stringify(transferMetadata(transferId, blob, metadata)));
    if (isCancelled(mesh, channel, lifecycle, active, options.signal)) throw cancelledError();
    const ready = await admission;
    const windowBytes = Number(ready?.windowBytes);
    mesh.pendingTransferCredits.set(transferId, {
      participantId,
      channel,
      available:
        Number.isFinite(windowBytes) && windowBytes > 0
          ? Math.min(TRANSFER_LIMITS.pendingWriteBytes, windowBytes)
          : TRANSFER_LIMITS.pendingWriteBytes,
      waiters: []
    });
    await streamFile(
      mesh,
      { active, channel, lifecycle, participantId, transferId },
      blob,
      metadata,
      options.signal
    );
    if (isCancelled(mesh, channel, lifecycle, active, options.signal)) throw cancelledError();
    confirmation = createPending(
      mesh,
      mesh.pendingTransferConfirmations,
      transferId,
      participantId,
      channel,
      TRANSFER_TIMEOUTS.confirmation,
      "Участник не подтвердил получение песни"
    );
    channel.send(JSON.stringify({ type: "file-end", transferId }));
    await confirmation;
    mesh.emitTransferProgress(participantId, "complete", 100, metadata);
  } finally {
    admission?.catch(() => {});
    confirmation?.catch(() => {});
    cancelOutboundTransferById(mesh, transferId, cancelledError());
    mesh.pendingTransferCredits.delete(transferId);
    mesh.outboundTransfers.delete(transferId);
    options.signal?.removeEventListener?.("abort", abort);
  }
}
