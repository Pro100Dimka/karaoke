import { api } from "../../../api/client";
import { translateSaved as t } from "../../../i18n/runtime";
import { getErrorMessage } from "../../../utils/errors";
import { readJsonStorage, writeJsonStorage } from "../../../utils/storage";

const STORAGE_KEY = "karaoke-pending-recording-session";
const UNKNOWN_ERROR = "room.transfer.unknownError";
const finalizing = new Map();
const keyOf = (id) => (id == null || id === "" ? null : String(id));

export const pendingRecordingIds = () => {
  const value = readJsonStorage(STORAGE_KEY, {});
  return [...new Set([...(Array.isArray(value.ids) ? value.ids : []), value.id].map(keyOf).filter(Boolean))];
};

const writePending = (ids) =>
  writeJsonStorage(STORAGE_KEY, ids.length > 1 ? { id: ids[0], ids } : ids[0] ? { id: ids[0] } : {});

export const rememberPending = (id) => {
  const key = keyOf(id);
  if (key) writePending([...new Set([...pendingRecordingIds(), key])]);
};
export const forgetPending = (id) => {
  const key = keyOf(id);
  if (key) writePending(pendingRecordingIds().filter((value) => value !== key));
};

export function finalizeRecording(id) {
  const key = keyOf(id);
  if (!key) return Promise.resolve({ missing: true });
  if (finalizing.has(key)) return finalizing.get(key);

  const request = (async () => {
    try {
      const recording = await api.stopRecording(key);
      forgetPending(key);
      return { recording };
    } catch (error) {
      if (Number(error?.status) === 404) {
        forgetPending(key);
        return { missing: true };
      }
      rememberPending(key);
      await api.pauseRecording(key).catch(() => {});
      return { error };
    } finally {
      finalizing.delete(key);
    }
  })();

  finalizing.set(key, request);
  return request;
}

export const formatError = (message, error) =>
  t(message, { 0: getErrorMessage(error, t(UNKNOWN_ERROR)) });
