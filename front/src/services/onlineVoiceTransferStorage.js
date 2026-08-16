// eslint-disable-next-line import/extensions
import { translateSaved } from "../i18n/runtime";

const MAX_MEMORY_FALLBACK_BYTES = 64 * 1024 * 1024;
const REMOVE_RETRIES = 3;
const REMOVE_RETRY_DELAY_MS = 75;
const wait = (ms) =>
  new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });

async function removeTempEntry(root, name) {
  let lastError;
  for (let attempt = 0; attempt < REMOVE_RETRIES; attempt += 1) {
    try {
      await root.removeEntry(name);
      return;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < REMOVE_RETRIES) await wait(REMOVE_RETRY_DELAY_MS * (attempt + 1));
    }
  }
  console.error?.("Could not remove temporary song transfer file", name, lastError);
}

export const createTransferSink = (participantId, metadata) => {
  const getDirectory = globalThis.navigator?.storage?.getDirectory;
  if (typeof getDirectory === "function")
    return (async () => {
      const root = await getDirectory.call(globalThis.navigator.storage);
      const safeId = `${participantId}-${metadata.transferId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
      const name = `advoice-transfer-${safeId}.part`;
      const handle = await root.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      let state = "open";
      const close = async () => {
        if (state !== "open") return;
        state = "closing";
        try {
          await writable.close();
          state = "closed";
        } catch (error) {
          state = "open";
          throw error;
        }
      };
      return {
        write: (chunk) => {
          if (state !== "open")
            throw new Error(translateSaved("Временный файл передачи уже закрыт"));
          return writable.write(chunk);
        },
        finish: async () => {
          await close();
          return handle.getFile();
        },
        cleanup: async () => {
          if (state === "open" || state === "closing") {
            state = "aborted";
            try {
              await writable.abort?.();
            } catch {
              /* cleanup continues */
            }
          }
          await removeTempEntry(root, name);
        }
      };
    })();
  if (metadata.size > MAX_MEMORY_FALLBACK_BYTES)
    throw new Error(translateSaved("Для большого файла требуется дисковое хранилище браузера"));
  const chunks = [];
  return {
    chunks,
    write: (chunk) => chunks.push(chunk),
    finish: () => new globalThis.Blob(chunks, { type: metadata.mimeType }),
    cleanup: async () => {
      chunks.length = 0;
    }
  };
};

export const cleanupIncomingTransfer = (transfer) => {
  if (!transfer || transfer.cleanupStarted) return;
  transfer.cleanupStarted = true;
  transfer.cancelled = true;
  transfer.controller?.abort?.();
  transfer.cancelFinalization?.();
  if (transfer.timer) globalThis.clearTimeout(transfer.timer);
  Promise.resolve(transfer.sink)
    .then((sink) => sink?.cleanup?.())
    .catch((error) => {
      console.error?.("Could not cleanup incoming song transfer", error);
    });
};
