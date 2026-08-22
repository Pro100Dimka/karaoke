import { isRecord, readJsonStorage, writeJsonStorage } from "./storage";

const STORAGE_KEY = "karaoke-audio-preferences";
const DEFAULT_DEVICE = "default";
export const DEFAULT_AUDIO_PREFERENCES = Object.freeze({
  monitorInputDeviceId: DEFAULT_DEVICE,
  monitorOutputDeviceId: DEFAULT_DEVICE
});

const deviceId = (value) => (typeof value === "string" && value.trim() ? value : DEFAULT_DEVICE);
const normalize = (value = {}) => ({
  monitorInputDeviceId: deviceId(value.monitorInputDeviceId),
  monitorOutputDeviceId: deviceId(value.monitorOutputDeviceId)
});

export const getAudioPreferences = () => normalize(readJsonStorage(STORAGE_KEY));

export function saveAudioPreferences(patch) {
  const next = normalize({ ...getAudioPreferences(), ...(isRecord(patch) ? patch : {}) });
  writeJsonStorage(STORAGE_KEY, next);
  try {
    globalThis.dispatchEvent(new CustomEvent("audio-preferences-changed", { detail: next }));
  } catch {
    // A restricted renderer may expose storage without DOM events.
  }
  return next;
}
