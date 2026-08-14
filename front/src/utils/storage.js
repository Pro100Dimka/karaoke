export function getBrowserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function readJsonStorage(
  key,
  fallback = {},
  storage = getBrowserStorage()
) {
  try {
    const normalizedKey = String(key ?? "").trim();
    if (!normalizedKey) return fallback;
    const parsed = JSON.parse(storage.getItem(normalizedKey));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : fallback;
  } catch {
    return fallback;
  }
}

export function writeJsonStorage(key, value, storage = getBrowserStorage()) {
  try {
    const normalizedKey = String(key ?? "").trim();
    if (!normalizedKey) return false;
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return false;
    storage.setItem(normalizedKey, serialized);
    return true;
  } catch {
    return false;
  }
}
