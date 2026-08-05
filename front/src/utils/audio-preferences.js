const STORAGE_KEY = "karaoke-audio-preferences";

export const DEFAULT_AUDIO_PREFERENCES = Object.freeze({
  monitorInputDeviceId: "default",
  monitorOutputDeviceId: "default",
  monitorLatencyHint: "interactive",
  monitorMode: "direct"
});

export function getAudioPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return { ...DEFAULT_AUDIO_PREFERENCES, ...saved };
  } catch {
    return { ...DEFAULT_AUDIO_PREFERENCES };
  }
}

export function saveAudioPreferences(patch) {
  const next = { ...getAudioPreferences(), ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("audio-preferences-changed", { detail: next }));
  } catch {
    // Storage is optional; the current session still keeps the selected value.
  }
  return next;
}
