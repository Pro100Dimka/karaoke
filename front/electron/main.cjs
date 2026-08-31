// Electron main-процесс.
//
// Отвечает за:
//  1) создание окна приложения (безрамочное — свой titlebar в React,
//     как на референсе со скриншота: кнопки свернуть/развернуть/закрыть);
//  2) запуск python-backend (uvicorn) как дочернего процесса при старте
//     программы и его остановку при закрытии — пользователь просто
//     запускает "A&D Voice", ему не нужно отдельно поднимать backend;
//  3) IPC-мостик для управления окном и открытия папки песни в проводнике.

const fs = require("fs");

const path = require("path");
const { pathToFileURL } = require("url");
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  net,
  protocol,
  session,
  shell
} = require("electron");

const { installBackendFileAuthentication } = require("./backend-media-auth.cjs");
const { createBackendProcess } = require("./backend-process.cjs");
const { DEV_RENDERER_ORIGIN } = require("./runtime-config.cjs");
const {
  getPackagedRendererUrl,
  isAllowedPermissionRequest,
  isAllowedRendererUrl,
  isTrustedIpcEvent,
  registerTrustedIpc
} = require("./security.cjs");
const { findMatchingSongFolder } = require("./song-folders.cjs");
const { readThemeBackgrounds } = require("./theme-backgrounds.cjs");
const { createThemeIcons } = require("./theme-icons.cjs");

// Background radio is an intentional desktop feature.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
// Chromium otherwise chooses a conservative Windows render buffer on many
// consumer USB headsets. 128 frames is one Web Audio render quantum (about
// 2.7 ms at 48 kHz) and keeps the room path interactive without relying on a
// professional ASIO device.
app.commandLine.appendSwitch("audio-buffer-size", "128");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "karaoke-media",
    privileges: { secure: true, standard: true, stream: true, supportFetchAPI: true }
  }
]);

const isDev = !app.isPackaged;
const IS_WINDOWS = process.platform === "win32";
const INSTALL_ROOT = isDev ? path.resolve(__dirname, "..", "..") : path.dirname(process.execPath);
const INSTALL_DATA_ROOT = isDev
  ? path.resolve(__dirname, "..", ".runtime")
  : path.join(INSTALL_ROOT, "data");
const ELECTRON_PROFILE_DIR = path.join(INSTALL_DATA_ROOT, "electron-profile");
const INSTALL_TEMP_DIR = path.join(INSTALL_DATA_ROOT, "temp");
const INSTALL_LOG_DIR = path.join(INSTALL_DATA_ROOT, "logs");
const INSTALL_SESSION_DIR = path.join(ELECTRON_PROFILE_DIR, "session");
const INSTALL_CRASH_DIR = path.join(INSTALL_DATA_ROOT, "crash-dumps");

// Keep every writable runtime artefact next to the installed application.
// This includes Chromium profile/session data, crash dumps and process temp files.
for (const directory of [
  ELECTRON_PROFILE_DIR,
  INSTALL_SESSION_DIR,
  INSTALL_TEMP_DIR,
  INSTALL_LOG_DIR,
  INSTALL_CRASH_DIR
]) {
  fs.mkdirSync(directory, { recursive: true });
}
app.setPath("userData", process.env.KARAOKE_ELECTRON_PROFILE || ELECTRON_PROFILE_DIR);
app.setPath("sessionData", INSTALL_SESSION_DIR);
app.setPath("temp", INSTALL_TEMP_DIR);
app.setPath("logs", INSTALL_LOG_DIR);
app.setPath("crashDumps", INSTALL_CRASH_DIR);
process.env.TEMP = INSTALL_TEMP_DIR;
process.env.TMP = INSTALL_TEMP_DIR;
process.env.TMPDIR = INSTALL_TEMP_DIR;

// A small, separate file (not application.log, which the backend owns and
// rotates) recording cold/warm launch timings: how long each stage of
// startup took, one line per milestone, so a slow launch can be narrowed
// down without guessing. Kept tiny -- only ever appended, one line per
// milestone per run -- so it doesn't need rotation of its own.
const STARTUP_TIMELINE_PATH = path.join(INSTALL_LOG_DIR, "startup-timeline.log");
const startupBeganAt = Date.now();
const recordedStartupMilestones = new Set();
function recordStartupMilestone(name) {
  if (recordedStartupMilestones.has(name)) return;
  recordedStartupMilestones.add(name);
  const elapsedMs = Date.now() - startupBeganAt;
  try {
    fs.appendFileSync(
      STARTUP_TIMELINE_PATH,
      `${new Date().toISOString()} +${elapsedMs}ms ${name}\n`
    );
  } catch {
    // Best-effort diagnostics; must never break startup itself.
  }
}
recordStartupMilestone("electron-process-start");

let mainWindow = null;
let isQuitting = false;
const backend = createBackendProcess({
  isDev,
  INSTALL_DATA_ROOT,
  INSTALL_ROOT,
  INSTALL_LOG_DIR,
  IS_WINDOWS,
  isQuitting: () => isQuitting,
  recordStartupMilestone
});
const { configureRuntimeBackendEndpoint, resolveSongOutputDir, startBackend, stopBackend } =
  backend;
function resolveSceneVideoPath() {
  return isDev
    ? path.resolve(__dirname, "..", "..", "downloads", "media", "videoplayback.webm")
    : path.join(process.resourcesPath, "media", "videoplayback.webm");
}

function registerMediaProtocol() {
  protocol.handle("karaoke-media", (request) => {
    const requestUrl = new URL(request.url);
    if (requestUrl.hostname !== "scene" || requestUrl.pathname !== "/main") {
      return new Response("Not found", { status: 404 });
    }

    const scenePath = resolveSceneVideoPath();
    if (!fs.existsSync(scenePath))
      return new Response("Scene video is unavailable", { status: 404 });

    return net.fetch(pathToFileURL(scenePath).href, { headers: request.headers });
  });
}

function isPathInside(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

const {
  THEME_ICONS,
  getStoredIconTheme,
  storeIconTheme,
  getThemeIcon,
  getThemeShortcutIcon,
  updateThemeShortcuts
} = createThemeIcons({ app, shell, isDev });
handleTrustedIpc("window:setIconTheme", (theme) => {
  if (!mainWindow || !THEME_ICONS[theme] || theme === "app") return false;

  const iconPath = getThemeIcon(theme);
  storeIconTheme(theme);
  mainWindow.setIcon(iconPath);
  updateThemeShortcuts(getThemeShortcutIcon(theme));

  return true;
});
function createWindow() {
  const initialTheme = getStoredIconTheme();
  const themeBackgrounds = readThemeBackgrounds();
  if (!isDev) storeIconTheme(initialTheme);
  mainWindow = new BrowserWindow({
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    fullscreen: true,
    icon: getThemeIcon(initialTheme),

    // Match the native window surface to the selected theme. The renderer is
    // revealed only after its large backdrop image has decoded, so neither
    // Electron nor the page can flash white during application startup.
    backgroundColor: themeBackgrounds[initialTheme] || themeBackgrounds.dark,
    show: false,

    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The API token is deliberately NOT included here: additionalArguments
      // become part of the renderer process's own OS command line, readable
      // by any other process on the machine (Task Manager, `ps`, etc.), not
      // just this renderer's JS. It is instead handed to preload over a
      // synchronous IPC round trip (see the "advoice:get-api-token" handler
      // below), which only this window's own webContents can reach.
      additionalArguments: [
        `--advoice-theme=${initialTheme}`,
        `--advoice-backend-url=${backend.url}`
      ]
    }
  });
  recordStartupMilestone("window-create");
  mainWindow.webContents.once("did-finish-load", () => recordStartupMilestone("frontend-loaded"));
  // Apply the initial window state before loading/rendering so the first
  // visible frame already occupies the full work area (no 1440x900 flash).
  // mainWindow.maximize();
  updateThemeShortcuts(getThemeShortcutIcon(initialTheme));

  const packagedIndexPath = path.join(__dirname, "..", "dist", "index.html");
  const packagedIndexUrl = getPackagedRendererUrl(packagedIndexPath);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Only this explicit help link may leave the renderer; never launch an
    // installer, arbitrary protocol, or an untrusted URL from room metadata.
    if (url === "https://asio4all.org/about/download-asio4all/") {
      shell
        .openExternal(url)
        .catch((error) => process.stderr.write(`Could not open ASIO4ALL help: ${error.message}\n`));
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
    const allowed = isAllowedRendererUrl(navigationUrl, {
      isDev,
      devOrigin: DEV_RENDERER_ORIGIN,
      packagedIndexUrl
    });
    if (!allowed) event.preventDefault();
  });

  let revealFallbackTimer = null;
  let windowRevealed = false;
  const revealWindow = () => {
    if (revealFallbackTimer) clearTimeout(revealFallbackTimer);
    revealFallbackTimer = null;
    windowRevealed = true;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  };
  mainWindow.__revealWhenVisualReady = revealWindow;
  mainWindow.once("ready-to-show", () => {
    if (windowRevealed) return;
    // Never leave the application invisible if a corrupt/missing image cannot
    // decode. Normal startup is revealed earlier by the visual-ready signal.
    revealFallbackTimer = setTimeout(revealWindow, 4000);
  });

  const loadPromise = isDev
    ? mainWindow.loadURL(DEV_RENDERER_ORIGIN)
    : mainWindow.loadFile(packagedIndexPath);
  loadPromise.catch((error) => {
    console.error("Не удалось загрузить интерфейс:", error);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });

  mainWindow.on("closed", () => {
    if (revealFallbackTimer) clearTimeout(revealFallbackTimer);
    mainWindow = null;
  });
  const notifyFullscreenChange = (isFullScreen) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("window:fullscreen-changed", isFullScreen);
  };
  mainWindow.on("enter-full-screen", () => notifyFullscreenChange(true));
  mainWindow.on("leave-full-screen", () => notifyFullscreenChange(false));
}

function handleTrustedIpc(channel, handler) {
  registerTrustedIpc(ipcMain, channel, () => mainWindow?.webContents, handler);
}

// Synchronous (not registerTrustedIpc's invoke/handle) because preload reads
// this once, at script load, before contextBridge exposes apiToken() to the
// renderer -- an async round trip there would leave a window where early
// API calls have no token. Only this window's own webContents may ask.
ipcMain.on("advoice:get-api-token", (event) => {
  event.returnValue = isTrustedIpcEvent(event, mainWindow?.webContents) ? backend.apiToken : "";
});

handleTrustedIpc("window:minimize", () => mainWindow?.minimize());
handleTrustedIpc("window:maximize", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
handleTrustedIpc("window:close", () => mainWindow?.close());
handleTrustedIpc("window:toggleFullscreen", () => {
  if (!mainWindow) return false;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
  return mainWindow.isFullScreen();
});
handleTrustedIpc("shell:openApplicationLog", async () => {
  const logDirectory = isDev
    ? path.resolve(__dirname, "..", "..", "generated", "logs")
    : INSTALL_LOG_DIR;
  const logPath = path.join(logDirectory, "application.log");
  if (!fs.existsSync(logPath)) return "Журнал приложения пока не создан.";
  return shell.openPath(logPath);
});
handleTrustedIpc("shell:openSongFolder", async (target) => {
  const request = typeof target === "string" ? { path: target } : target || {};
  const songsDir = await resolveSongOutputDir();
  const candidates = [
    request.path,
    request.slug && path.join(songsDir, request.slug),
    request.title && path.join(songsDir, request.title),
    request.id && path.join(songsDir, request.id)
  ].filter((value) => typeof value === "string" && value.trim());

  let realSongsDir;
  try {
    realSongsDir = fs.realpathSync.native(songsDir);
  } catch {
    return "Папка библиотеки песен пока не создана.";
  }

  for (const candidate of candidates) {
    try {
      const folderPath = fs.realpathSync.native(candidate);
      if (!isPathInside(realSongsDir, folderPath)) continue;
      const error = await shell.openPath(folderPath);
      return error || "";
    } catch {
      // Try the next safe candidate.
    }
  }

  try {
    const matchingEntry = findMatchingSongFolder(
      fs.readdirSync(realSongsDir, { withFileTypes: true }),
      [request.slug, request.title, request.id]
    );

    if (matchingEntry) {
      const error = await shell.openPath(path.join(realSongsDir, matchingEntry.name));
      return error || "";
    }
  } catch {
    // Fall through to the user-facing error.
  }

  return "Папка песни не найдена.";
});
handleTrustedIpc("dialog:selectFolder", async (currentPath) => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;

  const defaultPath =
    typeof currentPath === "string" && currentPath.trim() ? currentPath.trim() : undefined;

  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Выберите папку",
    defaultPath,
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || !result.filePaths?.length) return null;
  return result.filePaths[0];
});
handleTrustedIpc("clipboard:writeText", (value) => {
  if (typeof value !== "string" || value.length > 256) return false;
  clipboard.writeText(value);
  return true;
});

const RENDERER_STARTUP_MILESTONES = new Set(["visual-ready", "backend-healthy", "app-interactive"]);
handleTrustedIpc("startup:milestone", (name) => {
  if (!RENDERER_STARTUP_MILESTONES.has(name)) return false;
  recordStartupMilestone(name);
  if (name === "visual-ready") mainWindow?.__revealWhenVisualReady?.();
  return true;
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  isQuitting = true;
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  if (IS_WINDOWS) app.setAppUserModelId("com.karaokestudio.app");
  await configureRuntimeBackendEndpoint();
  registerMediaProtocol();
  installBackendFileAuthentication(
    session.defaultSession.webRequest,
    backend.url,
    backend.apiToken
  );
  const packagedIndexUrl = getPackagedRendererUrl(path.join(__dirname, "..", "dist", "index.html"));
  const rendererOptions = { isDev, devOrigin: DEV_RENDERER_ORIGIN, packagedIndexUrl };
  const permissionAllowed = (webContents, permission, requestUrl, details) =>
    isAllowedPermissionRequest({
      permission,
      requestUrl: requestUrl || webContents?.getURL(),
      mediaTypes: details?.mediaTypes,
      webContents,
      expectedWebContents: mainWindow?.webContents,
      rendererOptions
    });

  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) =>
      permissionAllowed(webContents, permission, requestingOrigin, details)
  );
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      // The app uses audio capture only. Never grant camera/media permissions
      // to a navigation, popup, or arbitrary origin sharing the session.
      callback(permissionAllowed(webContents, permission, details?.requestingUrl, details));
    }
  );
  startBackend();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
  isQuitting = true;
  stopBackend();
  app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  stopBackend();
});
