import { clamp as clampRange } from "../../../utils/math";

export const KARAOKE_PREFERENCES_KEY = "karaoke-player-preferences";

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? clampRange(number, min, max) : fallback;
};

const boolean = (value, fallback) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  }
  return fallback;
};

const timingOffsets = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 500)
      .map(([songId, offset]) => [String(songId), clamp(offset, -10, 10, 0)])
  );
};

export function normalizeKaraokePreferences(preferences) {
  const source =
    preferences && typeof preferences === "object" && !Array.isArray(preferences)
      ? preferences
      : {};

  const effectPreset =
    typeof source.effectPreset === "string" && source.effectPreset.trim()
      ? source.effectPreset.trim()
      : "studio";

  return {
    musicVolume: clamp(source.musicVolume, 0, 1, 1),
    vocalVolume: clamp(source.vocalVolume, 0, 1, 1),
    melodyVolume: clamp(source.melodyVolume, 0, 1, 0),
    speed: clamp(source.speed, 0.5, 1.5, 1),
    keyShift: Math.round(clamp(source.keyShift, -12, 12, 0)),
    showLyrics: boolean(source.showLyrics, true),
    showNotes: boolean(source.showNotes, true),
    autoHideConsole: boolean(source.autoHideConsole, true),
    effectPreset,
    timingOffsets: timingOffsets(source.timingOffsets)
  };
}

export function loadKaraokePreferences(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(KARAOKE_PREFERENCES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return normalizeKaraokePreferences(parsed);
  } catch {
    return normalizeKaraokePreferences({});
  }
}

export function saveKaraokePreferences(preferences, storage = globalThis.localStorage) {
  try {
    const serialized = JSON.stringify(normalizeKaraokePreferences(preferences));
    storage.setItem(KARAOKE_PREFERENCES_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}
