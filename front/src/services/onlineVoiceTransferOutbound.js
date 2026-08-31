import { translateSaved } from "../i18n/runtime";
import { generateId } from "../utils/id";
import {
  cancelOutboundTransferById,
  sendTransferStatus,
  TRANSFER_LIMITS,
  TRANSFER_STAGES,
  TRANSFER_TIMEOUTS,
  wait,
  waitAbortable
} from "./onlineVoiceTransferProtocol";

const CLOSED = new Set(["closing", "closed"]);
const STALE_CONNECTING_MS = 8_000;
const cancelledError = () => new Error(translateSaved("room.fileTransferCanceled"));
const isCancelled = (transfers, channel, lifecycle, active, signal) =>
  active.cancelled ||
  signal?.aborted ||
  lifecycle !== transfers.lifecycleVersion ||
  channel.readyState !== "open";

export async function waitForDataChannel(
  transfers,
  participantId,
  timeoutMs,
  lifecycleVersion,
  signal
) {
  const lifecycle = lifecycleVersion ?? transfers.lifecycleVersion;
  const numericTimeout = Number(timeoutMs ?? 15_000);
  const timeout = Number.isFinite(numericTimeout)
    ? Math.max(0, Math.min(60_000, numericTimeout))
    : 15_000;
  const startedAt = Date.now();
  let connectingSince = null;
  while (Date.now() - startedAt < timeout) {
    if (signal?.aborted || lifecycle !== transfers.lifecycleVersion) throw cancelledError();
    const channel = transfers.channels.get(participantId);
    if (channel?.readyState === "open") return channel;
    if (CLOSED.has(channel?.readyState)) {
      if (transfers.channels.get(participantId) === channel)
        transfers.channels.delete(participantId);
      if (!transfers.hasPeer(participantId))
        throw new Error(translateSaved("room.theSongTransmissionChannelIsClosed"));
      connectingSince = null;
    } else if (channel?.readyState === "connecting") {
      connectingSince ??= Date.now();
      if (Date.now() - connectingSince >= STALE_CONNECTING_MS) {
        // A failed SDP negotiation can leave a channel stuck in `connecting` forever.
        // Drop only that unopened channel and renegotiate; never touch an open transfer.
        if (transfers.channels.get(participantId) === channel) {
          transfers.channels.delete(participantId);
          channel.close?.();
        }
        connectingSince = null;
      }
    } else {
      connectingSince = null;
    }

    if (!transfers.channels.get(participantId) && transfers.hasPeer(participantId)) {
      // eslint-disable-next-line no-await-in-loop
      await transfers.invite(participantId).catch(() => false);
    }
    // eslint-disable-next-line no-await-in-loop
    await waitAbortable(50, signal);
  }
  if (signal?.aborted) throw cancelledError();
  throw new Error(translateSaved("room.theSongTransmissionChannelIsNotReady"));
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

function createPending(transfers, store, transferId, participantId, channel, timeout, message) {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      store.delete(transferId);
      reject(new Error(translateSaved(message)));
    }, timeout);
    store.set(transferId, { participantId, channel, resolve, reject, timer });
  });
}

async function reserveCredit(transfers, transferId, bytes) {
  const flow = transfers.pendingTransferCredits.get(transferId);
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
      reject(new Error(translateSaved("room.receiverIsSavingTheSongTooSlowly")));
    }, TRANSFER_TIMEOUTS.stall);
    flow.waiters.push(waiter);
  });
}

async function streamFile(transfers, transfer, blob, metadata, signal) {
  const { active, channel, lifecycle, participantId, transferId } = transfer;
  const cancelled = () => isCancelled(transfers, channel, lifecycle, active, signal);
  transfers.emitTransferProgress(participantId, TRANSFER_STAGES.SENDING, 0, metadata);
  const chunkSize = 32 * 1024;
  let lastProgressAt = Date.now();
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    while (channel.bufferedAmount > 512 * 1024) {
      if (cancelled()) throw cancelledError();
      if (Date.now() - lastProgressAt > TRANSFER_TIMEOUTS.stall)
        throw new Error(translateSaved("room.songTransferStoppedTheParticipantIsNotResponding"));
      // eslint-disable-next-line no-await-in-loop
      await wait(20);
    }
    if (cancelled()) throw cancelledError();
    // eslint-disable-next-line no-await-in-loop
    const chunk = await blob.slice(offset, offset + chunkSize).arrayBuffer();
    if (cancelled()) throw cancelledError();
    // eslint-disable-next-line no-await-in-loop
    await reserveCredit(transfers, transferId, chunk.byteLength);
    if (cancelled()) throw cancelledError();
    channel.send(chunk);
    lastProgressAt = Date.now();
    transfers.emitTransferProgress(
      participantId,
      TRANSFER_STAGES.SENDING,
      Math.min(99, Math.floor((Math.min(offset + chunkSize, blob.size) / blob.size) * 100)),
      metadata
    );
  }
}

export async function sendFile(transfers, participantId, blob, metadata = {}, options = {}) {
  const BlobClass = globalThis.Blob;
  if (
    typeof participantId !== "string" ||
    !participantId ||
    participantId.length > 128 ||
    typeof BlobClass !== "function" ||
    !(blob instanceof BlobClass)
  )
    throw new TypeError(translateSaved("room.toTransferYouNeedAParticipantAndAFile"));
  if (blob.size > TRANSFER_LIMITS.fileBytes)
    throw new RangeError(translateSaved("room.theFileIsTooLargeToTransmitAcrossThe"));

  const lifecycle = transfers.lifecycleVersion;
  const transferId = generateId();
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const active = {
    participantId,
    channel: null,
    commandId: metadata?.commandId,
    controller,
    cancelled: false
  };
  transfers.outboundTransfers.set(transferId, active);
  const abort = () => {
    active.cancelled = true;
    controller?.abort?.();
    if (active.channel?.readyState === "open")
      sendTransferStatus(active.channel, { type: "file-cancel", transferId });
    cancelOutboundTransferById(transfers, transferId, cancelledError());
  };
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener?.("abort", abort, { once: true });

  let channel;
  let admission;
  let confirmation;
  try {
    channel = await transfers.waitForDataChannel(
      participantId,
      15_000,
      lifecycle,
      controller?.signal || options.signal
    );
    active.channel = channel;
    if (channel.readyState !== "open")
      throw new Error(translateSaved("room.theSongTransmissionChannelIsClosed"));
    if (isCancelled(transfers, channel, lifecycle, active, options.signal)) throw cancelledError();
    admission = createPending(
      transfers,
      transfers.pendingTransferAdmissions,
      transferId,
      participantId,
      channel,
      TRANSFER_TIMEOUTS.admission,
      "room.receiverDidNotConfirmReadinessToReceiveTheSong"
    );
    channel.send(JSON.stringify(transferMetadata(transferId, blob, metadata)));
    if (isCancelled(transfers, channel, lifecycle, active, options.signal)) throw cancelledError();
    const ready = await admission;
    const windowBytes = Number(ready?.windowBytes);
    transfers.pendingTransferCredits.set(transferId, {
      participantId,
      channel,
      available:
        Number.isFinite(windowBytes) && windowBytes > 0
          ? Math.min(TRANSFER_LIMITS.pendingWriteBytes, windowBytes)
          : TRANSFER_LIMITS.pendingWriteBytes,
      waiters: []
    });
    await streamFile(
      transfers,
      { active, channel, lifecycle, participantId, transferId },
      blob,
      metadata,
      options.signal
    );
    if (isCancelled(transfers, channel, lifecycle, active, options.signal)) throw cancelledError();
    confirmation = createPending(
      transfers,
      transfers.pendingTransferConfirmations,
      transferId,
      participantId,
      channel,
      TRANSFER_TIMEOUTS.confirmation,
      "room.theParticipantDidNotConfirmReceivingTheSong"
    );
    channel.send(JSON.stringify({ type: "file-end", transferId }));
    await confirmation;
    transfers.emitTransferProgress(participantId, TRANSFER_STAGES.COMPLETE, 100, metadata);
  } finally {
    admission?.catch(() => {});
    confirmation?.catch(() => {});
    cancelOutboundTransferById(transfers, transferId, cancelledError());
    transfers.pendingTransferCredits.delete(transferId);
    transfers.outboundTransfers.delete(transferId);
    options.signal?.removeEventListener?.("abort", abort);
  }
}
