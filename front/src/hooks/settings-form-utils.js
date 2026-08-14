export function prepareSettingValue(value) {
  return typeof value === "string" ? value.trim() : value;
}

function asSettings(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

export function mergeSettings(current, updated) {
  return { ...asSettings(current), ...asSettings(updated) };
}

export function resolveSavedSetting(updated, name, fallback) {
  const settings = asSettings(updated);
  return Object.hasOwn(settings, name) ? settings[name] : fallback;
}
