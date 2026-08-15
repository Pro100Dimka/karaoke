import { readJsonStorage, writeJsonStorage } from "./storage";

const STORAGE_KEY = "karaoke-audio-preferences";

export const DEFAULT_AUDIO_PREFERENCES = Object.freeze({
  monitorInputDeviceId: "default",
  monitorOutputDeviceId: "default",
  monitorLatencyHint: "interactive",
  monitorMode: "direct"
});

const VALID_LATENCY_HINTS = ["interactive", "balanced", "playback"];
const VALID_MONITOR_MODES = ["direct", "browser"];

function normalizeDeviceId(value) {
  return typeof value === "string" && value.trim() ? value : "default";
}

export function getAudioPreferences() {
  const stored = readJsonStorage(STORAGE_KEY);
  return {
    monitorInputDeviceId: normalizeDeviceId(stored.monitorInputDeviceId),
    monitorOutputDeviceId: normalizeDeviceId(stored.monitorOutputDeviceId),
    monitorLatencyHint: VALID_LATENCY_HINTS.includes(stored.monitorLatencyHint)
      ? stored.monitorLatencyHint
      : DEFAULT_AUDIO_PREFERENCES.monitorLatencyHint,
    monitorMode: VALID_MONITOR_MODES.includes(stored.monitorMode)
      ? stored.monitorMode
      : DEFAULT_AUDIO_PREFERENCES.monitorMode
  };
}

export function saveAudioPreferences(patch) {
  const current = getAudioPreferences();
  const source = patch && typeof patch === "object" ? patch : {};
  const candidate = { ...current, ...source };
  const next = {
    monitorInputDeviceId: normalizeDeviceId(candidate.monitorInputDeviceId),
    monitorOutputDeviceId: normalizeDeviceId(candidate.monitorOutputDeviceId),
    monitorLatencyHint: VALID_LATENCY_HINTS.includes(candidate.monitorLatencyHint)
      ? candidate.monitorLatencyHint
      : current.monitorLatencyHint,
    monitorMode: VALID_MONITOR_MODES.includes(candidate.monitorMode)
      ? candidate.monitorMode
      : current.monitorMode
  };
  writeJsonStorage(STORAGE_KEY, next);

  try {
    globalThis.dispatchEvent(
      new CustomEvent("audio-preferences-changed", { detail: next })
    );
  } catch {
    // Event dispatch is optional outside a browser context.
  }

  return next;
}
