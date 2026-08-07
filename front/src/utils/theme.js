const DEFAULT_THEME = "dark";
const THEME_STORAGE_KEY = "karaoke-theme";

export function resolveTheme(theme) {
  return typeof theme === "string" && theme.trim()
    ? theme.trim()
    : DEFAULT_THEME;
}

export function readStoredTheme(storage) {
  try {
    return resolveTheme(storage?.getItem?.(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function writeStoredTheme(storage, theme) {
  const resolvedTheme = resolveTheme(theme);

  try {
    storage?.setItem?.(THEME_STORAGE_KEY, resolvedTheme);
  } catch {
    // Storage can be unavailable in private or restricted environments.
  }

  return resolvedTheme;
}

export function applyTheme(theme) {
  const resolvedTheme = writeStoredTheme(window.localStorage, theme);

  document.documentElement.dataset.theme = resolvedTheme;

  window.electronAPI?.setIconTheme?.(resolvedTheme);

  return resolvedTheme;
}

export function getSavedTheme() {
  return readStoredTheme(window.localStorage);
}
