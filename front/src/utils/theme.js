const DEFAULT_THEME = "dark";
const THEME_STORAGE_KEY = "karaoke-theme";
const THEMES = new Set([DEFAULT_THEME, "light", "green", "violet"]);

export function resolveTheme(theme) {
  if (typeof theme !== "string") return DEFAULT_THEME;
  const candidate = theme.trim();
  return THEMES.has(candidate) ? candidate : DEFAULT_THEME;
}

export function readStoredTheme(storage) {
  // Stryker disable next-line ConditionalExpression: equivalent caught TypeError fallback.
  if (!storage || typeof storage.getItem !== "function") return DEFAULT_THEME;
  try {
    return resolveTheme(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function writeStoredTheme(storage, theme) {
  const resolvedTheme = resolveTheme(theme);

  // Stryker disable next-line ConditionalExpression: equivalent caught setter TypeError.
  if (storage && typeof storage.setItem === "function") {
    try {
      storage.setItem(THEME_STORAGE_KEY, resolvedTheme);
    } catch {
      // Storage can be unavailable in private or restricted environments.
    }
  }

  return resolvedTheme;
}

export function saveTheme(theme) {
  return writeStoredTheme(window.localStorage, theme);
}

export function applyTheme(theme) {
  const resolvedTheme = saveTheme(theme);

  document.documentElement.dataset.theme = resolvedTheme;

  const setIconTheme = window.electronAPI?.setIconTheme;
  if (typeof setIconTheme === "function") setIconTheme(resolvedTheme);

  return resolvedTheme;
}

export function getSavedTheme() {
  return readStoredTheme(window.localStorage);
}
