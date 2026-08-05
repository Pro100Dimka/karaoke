export const KARAOKE_PREFERENCES_KEY = "karaoke-player-preferences";

export function loadKaraokePreferences(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(KARAOKE_PREFERENCES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

export function saveKaraokePreferences(
  preferences,
  storage = globalThis.localStorage
) {
  try {
    storage?.setItem?.(
      KARAOKE_PREFERENCES_KEY,
      JSON.stringify(preferences ?? {})
    );
    return true;
  } catch {
    return false;
  }
}
