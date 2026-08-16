export const interpolate = (message, values = {}) =>
  message.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`));

export function translate(messages, language, key, values = {}, fallback = key) {
  const normalizedLanguage = messages[language] ? language : "uk";
  const localized = messages[normalizedLanguage][key];
  if (localized != null) return interpolate(localized, values);
  if (normalizedLanguage === "ru") return interpolate(fallback, values);
  const message = messages.uk[key] ?? fallback;
  return interpolate(message, values);
}

export function missingTranslationKeys(messages) {
  const expected = Object.keys(messages.uk ?? {});
  return Object.fromEntries(
    Object.entries(messages).map(([language, catalog]) => [
      language,
      expected.filter((key) => !(key in catalog))
    ])
  );
}
