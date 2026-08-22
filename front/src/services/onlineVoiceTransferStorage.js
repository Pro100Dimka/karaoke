import { translateSaved as translate } from "../i18n/runtime";

const MEMORY_LIMIT = 64 * 1024 * 1024;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function remove(root, name) {
  let failure;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await root.removeEntry(name);
      return;
    } catch (error) {
      failure = error;
      if (attempt < 2) await delay(75 * (attempt + 1));
    }
  }
  console.error?.("Could not remove temporary song transfer file", name, failure);
}

async function createDiskSink(participantId, metadata, getDirectory) {
  const root = await getDirectory.call(navigator.storage);
  const id = `${participantId}-${metadata.transferId}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const name = `advoice-transfer-${id}.part`;
  const handle = await root.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  let state = "open";
  return {
    write(chunk) {
      if (state !== "open") throw new Error(translate("Временный файл передачи уже закрыт"));
      return writable.write(chunk);
    },
    async finish() {
      if (state === "open") {
        state = "closing";
        try {
          await writable.close();
          state = "closed";
        } catch (error) {
          state = "open";
          throw error;
        }
      }
      return handle.getFile();
    },
    async cleanup() {
      if (["open", "closing"].includes(state)) {
        state = "aborted";
        try {
          await writable.abort?.();
        } catch {
          // Removing the temporary entry remains mandatory.
        }
      }
      await remove(root, name);
    }
  };
}

export function createTransferSink(participantId, metadata) {
  const getDirectory = globalThis.navigator?.storage?.getDirectory;
  if (typeof getDirectory === "function")
    return createDiskSink(participantId, metadata, getDirectory);
  if (metadata.size > MEMORY_LIMIT)
    throw new Error(translate("Для большого файла требуется дисковое хранилище браузера"));
  const chunks = [];
  return {
    chunks,
    write: (chunk) => chunks.push(chunk),
    finish: () => new Blob(chunks, { type: metadata.mimeType }),
    cleanup: async () => {
      chunks.length = 0;
    }
  };
}

export function cleanupIncomingTransfer(transfer) {
  if (!transfer || transfer.cleanupStarted) return;
  Object.assign(transfer, { cleanupStarted: true, cancelled: true });
  transfer.controller?.abort?.();
  transfer.cancelFinalization?.();
  if (transfer.timer) clearTimeout(transfer.timer);
  Promise.resolve(transfer.sink)
    .then((sink) => sink?.cleanup?.())
    .catch((error) => console.error?.("Could not cleanup incoming song transfer", error));
}
