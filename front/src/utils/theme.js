import * as platform from "./platform";
import { getBrowserStorage } from "./storage";

const KEY = "karaoke-theme";
const DEFAULT = "dark";
const THEMES = new Set([DEFAULT, "light", "green", "violet"]);
export const THEME_BACKGROUNDS = Object.freeze({
  dark: "#050001",
  light: "#fff8f5",
  green: "#020904",
  violet: "#07020f"
});
export const resolveTheme = (theme) => {
  const value = typeof theme === "string" ? theme.trim() : "";
  return THEMES.has(value) ? value : DEFAULT;
};
export function readStoredTheme(storage) {
  try {
    return resolveTheme(storage?.getItem?.(KEY));
  } catch {
    return DEFAULT;
  }
}
export function writeStoredTheme(storage, theme) {
  const value = resolveTheme(theme);
  try {
    storage?.setItem?.(KEY, value);
  } catch {
    // Returning a valid theme is more important than optional local persistence.
  }
  return value;
}
export const saveTheme = (theme) => writeStoredTheme(getBrowserStorage(), theme);
export const getSavedTheme = () => readStoredTheme(getBrowserStorage());
export function applyTheme(theme) {
  const value = saveTheme(theme);
  if (globalThis.document?.documentElement) {
    document.documentElement.dataset.theme = value;
    const background = THEME_BACKGROUNDS[value] || THEME_BACKGROUNDS.dark;
    if (document.documentElement.style) document.documentElement.style.backgroundColor = background;
    if (document.body?.style) document.body.style.backgroundColor = background;
  }
  platform.setIconTheme(value);
  return value;
}
