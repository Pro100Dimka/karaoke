import { translateSaved } from "../i18n/runtime";

export const TRANSFER_LIMITS = Object.freeze({
  fileBytes: 512 * 1024 * 1024,
  transferId: 128,
  filename: 512,
  chunks: 32_768,
  message: 16 * 1024,
  pendingWriteBytes: 512 * 1024
});
export const TRANSFER_TIMEOUTS = Object.freeze({
  stall: 30_000,
  admission: 15_000,
  confirmation: 5 * 60_000,
  flush: 30_000,
  close: 30_000,
  import: 5 * 60_000
});
export const wait = (delayMs) =>
  new Promise((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
export const waitAbortable = (delayMs, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error(translateSaved("Передача файла отменена")));
    const done = () => {
      signal?.removeEventListener?.("abort", aborted);
      resolve();
    };
    const aborted = () => {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener?.("abort", aborted);
      reject(new Error(translateSaved("Передача файла отменена")));
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
export function cancelOutboundTransferById(mesh, transferId, error) {
  for (const store of [mesh.pendingTransferAdmissions, mesh.pendingTransferConfirmations]) {
    const pending = store.get(transferId);
    if (!pending) continue;
    store.delete(transferId);
    globalThis.clearTimeout(pending.timer);
    pending.reject(error);
  }
  const flow = mesh.pendingTransferCredits.get(transferId);
  if (!flow) return;
  mesh.pendingTransferCredits.delete(transferId);
  flow.waiters.forEach((waiter) => {
    globalThis.clearTimeout(waiter.timer);
    waiter.reject(error);
  });
}
