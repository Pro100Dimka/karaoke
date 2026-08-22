export const isRecord = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function getBrowserStorage() {
  try {
    return globalThis.localStorage ?? globalThis.window?.localStorage ?? null;
  } catch {
    return null;
  }
}

const keyOf = (key) => String(key ?? "").trim();

export function readJsonStorage(key, fallback = {}, storage = getBrowserStorage()) {
  try {
    const normalized = keyOf(key);
    if (!normalized || !storage) return fallback;
    const value = JSON.parse(storage.getItem(normalized));
    return isRecord(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writeJsonStorage(key, value, storage = getBrowserStorage()) {
  try {
    const normalized = keyOf(key);
    const serialized = JSON.stringify(value);
    if (!normalized || !storage || serialized === undefined) return false;
    storage.setItem(normalized, serialized);
    return true;
  } catch {
    return false;
  }
}
