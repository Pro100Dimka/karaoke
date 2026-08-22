export const interpolate = (message, values = {}) =>
  String(message).replace(/\{(\w+)\}/g, (token, key) => String(values[key] ?? token));

export function translate(catalogs, language, key, values = {}, fallback = key) {
  const locale = language in catalogs ? language : "uk";
  const message =
    catalogs[locale]?.[key] ?? (locale === "ru" ? fallback : catalogs.uk?.[key]) ?? fallback;
  return interpolate(message, values);
}

export const missingTranslationKeys = (catalogs) => {
  const expected = Object.keys(catalogs.uk ?? {});
  return Object.fromEntries(
    Object.entries(catalogs).map(([locale, catalog]) => [
      locale,
      expected.filter((key) => !(key in catalog))
    ])
  );
};
