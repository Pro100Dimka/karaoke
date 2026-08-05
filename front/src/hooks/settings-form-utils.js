export function prepareSettingValue(value) {
  return typeof value === "string" ? value.trim() : value;
}

export function mergeSettings(current, updated) {
  const currentSettings =
    current && typeof current === "object" && !Array.isArray(current)
      ? current
      : {};
  const updatedSettings =
    updated && typeof updated === "object" && !Array.isArray(updated)
      ? updated
      : {};

  return { ...currentSettings, ...updatedSettings };
}

export function resolveSavedSetting(updated, name, fallback) {
  if (
    updated &&
    typeof updated === "object" &&
    !Array.isArray(updated) &&
    Object.hasOwn(updated, name)
  ) {
    return updated[name];
  }

  return fallback;
}
