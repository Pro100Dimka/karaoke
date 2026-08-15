import { readJsonStorage, writeJsonStorage } from "./storage";

const STORAGE_KEY = "karaoke-audio-preferences";
export const DEFAULT_AUDIO_PREFERENCES = Object.freeze({
  monitorInputDeviceId: "default",
  monitorOutputDeviceId: "default"
});
const normalizeDeviceId = (value) =>
  typeof value === "string" && value.trim() ? value : "default";

export function getAudioPreferences() {
  const stored = readJsonStorage(STORAGE_KEY);
  return {
    monitorInputDeviceId: normalizeDeviceId(stored.monitorInputDeviceId),
    monitorOutputDeviceId: normalizeDeviceId(stored.monitorOutputDeviceId)
  };
}

export function saveAudioPreferences(patch) {
  const current = getAudioPreferences();
  const source = patch && typeof patch === "object" ? patch : {};
  const next = {
    monitorInputDeviceId: normalizeDeviceId(
      source.monitorInputDeviceId ?? current.monitorInputDeviceId
    ),
    monitorOutputDeviceId: normalizeDeviceId(
      source.monitorOutputDeviceId ?? current.monitorOutputDeviceId
    )
  };
  writeJsonStorage(STORAGE_KEY, next);
  try {
    globalThis.dispatchEvent( new CustomEvent("audio-preferences-changed", { detail: next })
    );
  } catch {}
  return next;
}
