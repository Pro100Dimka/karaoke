const LANGUAGE_KEY = "advoice-language";
// Stryker disable next-line StringLiteral: replacing "uk" is equivalent because
// normalizeLanguage deliberately falls back to the same "uk" value.
const SUPPORTED_LANGUAGES = ["uk", "ru", "en"];

export const normalizeLanguage = (language) =>
  SUPPORTED_LANGUAGES.includes(language) ? language : "uk";

export const getSavedLanguage = () => {
  try {
    return normalizeLanguage(globalThis.localStorage.getItem(LANGUAGE_KEY));
  } catch {
    return "uk";
  }
};

export const saveLanguage = (language) => {
  const normalized = normalizeLanguage(language);
  try {
    globalThis.localStorage.setItem(LANGUAGE_KEY, normalized);
  } catch {
    // Backend settings remain authoritative when storage is unavailable.
  }
  return normalized;
};
