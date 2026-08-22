export const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const getBrowserStorage = () => {
  try {
    return globalThis.localStorage ?? globalThis.window?.localStorage ?? null;
  } catch {
    return null;
  }
};
const keyOf = (key) => String(key ?? "").trim();
export function readJsonStorage(key, fallback = {}, storage = getBrowserStorage()) {
  try {
    const name = keyOf(key);
    if (!name || !storage) return fallback;
    const value = JSON.parse(storage.getItem(name));
    return isRecord(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
export function writeJsonStorage(key, value, storage = getBrowserStorage()) {
  try {
    const name = keyOf(key);
    const serialized = JSON.stringify(value);
    if (!name || !storage || serialized === undefined) return false;
    storage.setItem(name, serialized);
    return true;
  } catch {
    return false;
  }
}
