// eslint-disable-next-line import/extensions
import { translateSaved } from "../i18n/runtime.js";

const MAX_MEMORY_FALLBACK_BYTES = 64 * 1024 * 1024;

export const createTransferSink = (participantId, metadata) => {
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

export const cleanupIncomingTransfer = (transfer) => {
  if (!transfer || transfer.cleanupStarted) return;
  transfer.cleanupStarted = true;
  transfer.cancelled = true;
  transfer.controller?.abort?.();
  transfer.cancelFinalization?.();
  if (transfer.timer) globalThis.clearTimeout(transfer.timer);
  Promise.resolve(transfer.sink).then((sink) => sink.cleanup()).catch(() => {});
};
