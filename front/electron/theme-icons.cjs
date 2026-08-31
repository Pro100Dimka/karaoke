const fs = require("fs");
const path = require("path");

function createThemeIcons({ app, shell, isDev }) {
  const THEME_ICONS = {
    app: "app.ico",
    dark: "dark.ico",
    light: "light.ico",
    green: "green.ico",
    violet: "violet.ico"
  };
  const THEME_NAMES = Object.keys(THEME_ICONS).filter((name) => name !== "app");

  function getStoredIconTheme() {
    try {
      const theme = fs
        .readFileSync(path.join(app.getPath("userData"), "selected-theme.txt"), "utf8")
        .trim();
      return THEME_NAMES.includes(theme) ? theme : "dark";
    } catch {
      return "dark";
    }
  }

  function storeIconTheme(theme) {
    if (!THEME_NAMES.includes(theme)) return false;
    try {
      const userData = app.getPath("userData");
      fs.mkdirSync(userData, { recursive: true });
      fs.writeFileSync(path.join(userData, "selected-theme.txt"), theme, "utf8");
      fs.copyFileSync(getThemeIcon(theme), path.join(userData, "selected-theme.ico"));
      return true;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Could not persist themed application icon:", error);
      return false;
    }
  }

  function getThemeIcon(theme = "app") {
    const icon = THEME_ICONS[theme] ?? THEME_ICONS.app;

    return path.join(__dirname, "..", "assets", "icons", icon);
  }

  function getThemeShortcutIcon(theme) {
    if (isDev) return getThemeIcon(theme);
    const stored = path.join(app.getPath("userData"), "selected-theme.ico");
    return fs.existsSync(stored) ? stored : getThemeIcon(theme);
  }

  function updateThemeShortcuts(iconPath) {
    if (process.platform !== "win32" || isDev) return;
    const shortcutName = "A&D Voice.lnk";
    const candidates = [
      path.join(app.getPath("desktop"), shortcutName),
      path.join(
        app.getPath("appData"),
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
        shortcutName
      ),
      process.env.PUBLIC && path.join(process.env.PUBLIC, "Desktop", shortcutName),
      process.env.ProgramData &&
        path.join(
          process.env.ProgramData,
          "Microsoft",
          "Windows",
          "Start Menu",
          "Programs",
          shortcutName
        )
    ].filter(Boolean);

    for (const shortcutPath of new Set(candidates)) {
      if (!fs.existsSync(shortcutPath)) continue;
      try {
        const details = shell.readShortcutLink(shortcutPath);
        shell.writeShortcutLink(shortcutPath, "replace", {
          ...details,
          icon: iconPath,
          iconIndex: 0
        });
      } catch (error) {
        // A system-wide shortcut may require elevation; the window icon still updates.
        // eslint-disable-next-line no-console
        console.error("Could not update themed shortcut icon:", shortcutPath, error);
      }
    }
  }

  return {
    THEME_ICONS,
    getStoredIconTheme,
    storeIconTheme,
    getThemeIcon,
    getThemeShortcutIcon,
    updateThemeShortcuts
  };
}
module.exports = { createThemeIcons };
