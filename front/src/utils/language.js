const KEY = "advoice-language";
const DEFAULT = "uk";
const SUPPORTED = new Set([DEFAULT, "ru", "en"]);
export const normalizeLanguage = (value) => (SUPPORTED.has(value) ? value : DEFAULT);
export function getSavedLanguage() {
  try {
    return normalizeLanguage(globalThis.localStorage?.getItem(KEY));
  } catch {
    return DEFAULT;
  }
}
export function saveLanguage(language) {
  const value = normalizeLanguage(language);
  try {
    globalThis.localStorage?.setItem(KEY, value);
  } catch {
    // Backend persistence remains authoritative in restricted renderers.
  }
  return value;
}
