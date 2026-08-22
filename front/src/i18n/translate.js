export const interpolate = (message, values = {}) =>
  String(message).replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  );
export function translate(catalogs, language, key, values = {}, fallback = key) {
  const locale = language in catalogs ? language : "uk";
  return interpolate(
    catalogs[locale]?.[key] ?? (locale === "ru" ? fallback : catalogs.uk?.[key]) ?? fallback,
    values
  );
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
