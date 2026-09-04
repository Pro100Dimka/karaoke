import { translateSaved } from "../i18n/runtime";

export const TRANSFER_LIMITS = Object.freeze({
  fileBytes: 512 * 1024 * 1024,
  transferId: 128,
  filename: 512,
  chunks: 32_768,
  message: 16 * 1024,
  pendingWriteBytes: 8 * 1024 * 1024
});
// The single source of truth for every transfer progress stage this project
// emits. Sender and receiver each track their own local view of a transfer
// (there is no one shared authoritative status the way song.status is one
// row in a database), so this is a canonical vocabulary rather than a
// validated state machine -- but every emitTransferProgress() call site uses
// one of these instead of an ad hoc string literal, and COMPLETE/CANCELLED/
// ERROR are the only terminal ones.
export const TRANSFER_STAGES = Object.freeze({
  WAITING: "waiting",
  SENDING: "sending",
  RECEIVING: "receiving",
  IMPORTING: "importing",
  COMPLETE: "complete",
  CANCELLED: "cancelled",
  ERROR: "error"
});
export const TERMINAL_TRANSFER_STAGES = Object.freeze(
  new Set([TRANSFER_STAGES.COMPLETE, TRANSFER_STAGES.CANCELLED, TRANSFER_STAGES.ERROR])
);
export const TRANSFER_TIMEOUTS = Object.freeze({
  stall: 30_000,
  admission: 15_000,
  confirmation: 5 * 60_000,
  flush: 30_000,
  close: 30_000,
  import: 5 * 60_000
});
export const TRANSFER_CHUNK_BYTES = 32 * 1024;
export const TRANSFER_RESUME_TTL_MS = 10 * 60_000;
export async function digestHex(data) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(
    ""
  );
}
export function hashChunkManifest(chunkHashes) {
  const manifest = [...chunkHashes.entries()]
    .sort(([left], [right]) => left - right)
    .map(([offset, hash]) => `${offset}:${hash}`)
    .join("\n");
  return digestHex(new TextEncoder().encode(manifest));
}
export const wait = (delayMs) =>
  new Promise((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
export const waitAbortable = (delayMs, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error(translateSaved("room.fileTransferCanceled")));
    const done = () => {
      signal?.removeEventListener?.("abort", aborted);
      resolve();
    };
    const aborted = () => {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener?.("abort", aborted);
      reject(new Error(translateSaved("room.fileTransferCanceled")));
    };
    const timer = globalThis.setTimeout(done, delayMs);
    signal?.addEventListener?.("abort", aborted, { once: true });
  });
export function sendTransferStatus(channel, payload) {
  if (channel.readyState !== "open") return false;
  try {
    channel.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}
export function rejectPendingTransfers(transfers, matches, error) {
  for (const store of [
    transfers.pendingTransferAdmissions,
    transfers.pendingTransferConfirmations
  ]) {
    for (const [transferId, pending] of store) {
      if (!matches(pending, transferId)) continue;
      store.delete(transferId);
      globalThis.clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
  for (const [transferId, flow] of transfers.pendingTransferCredits) {
    if (!matches(flow, transferId)) continue;
    transfers.pendingTransferCredits.delete(transferId);
    flow.waiters.forEach((waiter) => {
      globalThis.clearTimeout(waiter.timer);
      waiter.reject(error);
    });
  }
}
export function cancelOutboundTransferById(transfers, transferId, error) {
  rejectPendingTransfers(transfers, (_entry, id) => id === transferId, error);
}
