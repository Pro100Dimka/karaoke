const plain = (value) => value != null && Object.getPrototypeOf(value) === Object.prototype;
const safeKeys = (value) =>
  Object.keys(value).filter((key) => !["__proto__", "constructor", "prototype"].includes(key));

function project(template, source, missingAsNull) {
  if (source === undefined) return missingAsNull ? null : template;
  if (source === null) return null;
  if (Array.isArray(template) && Array.isArray(source)) {
    return template.length
      ? source.map((item) => project(template[0], item, missingAsNull))
      : [...source];
  }
  if (plain(template) && plain(source)) {
    return Object.fromEntries(
      safeKeys(template).map((key) => [
        key,
        project(template[key], Object.hasOwn(source, key) ? source[key] : undefined, missingAsNull)
      ])
    );
  }
  return source;
}

// Whitelist keys using the shape of initialValues, including arrays of records.
export default function mergeProperties(initialValues, source) {
  return source == null
    ? project(initialValues, initialValues, false)
    : project(initialValues, source, true);
}

// Legacy name retained. Missing properties retain defaults; explicit null stays null.
export function mergePropertiesWithNull(initialValues, source) {
  return project(initialValues, source ?? initialValues, false);
}
