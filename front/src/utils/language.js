const STORAGE_KEY = "advoice-language";
const DEFAULT_LANGUAGE = "uk";
const SUPPORTED = new Set([DEFAULT_LANGUAGE, "ru", "en"]);

export const normalizeLanguage = (language) =>
  SUPPORTED.has(language) ? language : DEFAULT_LANGUAGE;

export function getSavedLanguage() {
  try {
    return normalizeLanguage(globalThis.localStorage?.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function saveLanguage(language) {
  const normalized = normalizeLanguage(language);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, normalized);
  } catch {
    // Backend settings remain authoritative when browser storage is restricted.
  }
  return normalized;
}
