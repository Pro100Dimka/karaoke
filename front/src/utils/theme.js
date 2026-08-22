import { getBrowserStorage } from "./storage";

const DEFAULT_THEME = "dark";
const STORAGE_KEY = "karaoke-theme";
const THEMES = new Set([DEFAULT_THEME, "light", "green", "violet"]);

export const resolveTheme = (theme) => {
  const value = typeof theme === "string" ? theme.trim() : "";
  return THEMES.has(value) ? value : DEFAULT_THEME;
};

export function readStoredTheme(storage) {
  try {
    return resolveTheme(storage?.getItem?.(STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function writeStoredTheme(storage, theme) {
  const value = resolveTheme(theme);
  try {
    storage?.setItem?.(STORAGE_KEY, value);
  } catch {
    // A valid theme is still returned when storage is unavailable.
  }
  return value;
}

export const saveTheme = (theme) => writeStoredTheme(getBrowserStorage(), theme);
export const getSavedTheme = () => readStoredTheme(getBrowserStorage());

export function applyTheme(theme) {
  const value = saveTheme(theme);
  const root = globalThis.document?.documentElement;
  if (root) root.dataset.theme = value;
  (globalThis.electronAPI ?? globalThis.window?.electronAPI)?.setIconTheme?.(value);
  return value;
}
