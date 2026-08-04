const DEFAULT_THEME = "dark";
const THEME_STORAGE_KEY = "karaoke-theme";

export function resolveTheme(theme) {
  return theme?.trim() || DEFAULT_THEME;
}

export function applyTheme(theme) {
  const resolvedTheme = resolveTheme(theme);

  document.documentElement.dataset.theme = resolvedTheme;
  window.localStorage.setItem(THEME_STORAGE_KEY, resolvedTheme);

  return resolvedTheme;
}

export function getSavedTheme() {
  return resolveTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
}
