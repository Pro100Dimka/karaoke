import { readJsonStorage, writeJsonStorage } from "./storage";

const STORAGE_KEY = "karaoke-audio-preferences";

export const DEFAULT_AUDIO_PREFERENCES = Object.freeze({
  monitorInputDeviceId: "default",
  monitorOutputDeviceId: "default",
  monitorLatencyHint: "interactive",
  monitorMode: "direct"
});

export function getAudioPreferences() {
  return {
    ...DEFAULT_AUDIO_PREFERENCES,
    ...readJsonStorage(STORAGE_KEY)
  };
}

export function saveAudioPreferences(patch) {
  const next = { ...getAudioPreferences(), ...patch };
  writeJsonStorage(STORAGE_KEY, next);

  try {
    globalThis.dispatchEvent?.(
      new CustomEvent("audio-preferences-changed", { detail: next })
    );
  } catch {
    // Event dispatch is optional outside a browser context.
  }

  return next;
}
