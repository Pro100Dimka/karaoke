import { api } from "../../../api/client";
import { translateSaved } from "../../../i18n/runtime";
import { getErrorMessage } from "../../../utils/errors";
import { readJsonStorage, writeJsonStorage } from "../../../utils/storage";

const PENDING_RECORDING_KEY = "karaoke-pending-recording-session";
const UNKNOWN_ERROR = "room.transfer.unknownError";
const finalizingRecordings = new Map();
export const pendingRecordingIds = () => {
  const value = readJsonStorage(PENDING_RECORDING_KEY, {});
  return [...new Set([...(Array.isArray(value.ids) ? value.ids : []), value.id].filter(Boolean))];
};
const writePending = (ids) =>
  writeJsonStorage(
    PENDING_RECORDING_KEY,
    ids.length > 1 ? { id: ids[0], ids } : ids.length ? { id: ids[0] } : {}
  );
export const rememberPending = (id) => writePending([...new Set([...pendingRecordingIds(), id])]);
export const forgetPending = (id) =>
  writePending(pendingRecordingIds().filter((value) => value !== id));
const isMissingSession = (error) => Number(error?.status) === 404;
export function finalizeRecording(id) {
  if (finalizingRecordings.has(id)) return finalizingRecordings.get(id);
  const pending = (async () => {
    try {
      const recording = await api.stopRecording(id);
      forgetPending(id);
      return { recording };
    } catch (error) {
      if (isMissingSession(error)) {
        forgetPending(id);
        return { missing: true };
      }
      rememberPending(id);
      await api.pauseRecording(id).catch(() => {});
      return { error };
    } finally {
      finalizingRecordings.delete(id);
    }
  })();
  finalizingRecordings.set(id, pending);
  return pending;
}
export const formatError = (message, error) =>
  translateSaved(message, { 0: getErrorMessage(error, translateSaved(UNKNOWN_ERROR)) });
