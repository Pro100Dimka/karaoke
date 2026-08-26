// Electron main-процесс.
//
// Отвечает за:
//  1) создание окна приложения (безрамочное — свой titlebar в React,
//     как на референсе со скриншота: кнопки свернуть/развернуть/закрыть);
//  2) запуск python-backend (uvicorn) как дочернего процесса при старте
//     программы и его остановку при закрытии — пользователь просто
//     запускает "A&D Voice", ему не нужно отдельно поднимать backend;
//  3) IPC-мостик для управления окном и открытия папки песни в проводнике.
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
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

const { chooseRuntimeBackendEndpoint } = require("./backend-endpoint.cjs");
const { installBackendFileAuthentication } = require("./backend-media-auth.cjs");
const {
  BACKEND_HOST,
  BACKEND_PORT,
  BACKEND_REQUEST_TIMEOUT_MS,
  BACKEND_RESTART_BASE_DELAY_MS,
  BACKEND_RESTART_MAX_DELAY_MS,
  BACKEND_STOP_GRACE_MS,
  BACKEND_URL,
  DEV_RENDERER_ORIGIN
} = require("./runtime-config.cjs");
const {
  getPackagedRendererUrl,
  isAllowedPermissionRequest,
  isAllowedRendererUrl,
  isTrustedIpcEvent,
  registerTrustedIpc
} = require("./security.cjs");
const { findMatchingSongFolder } = require("./song-folders.cjs");

// Background radio is an intentional desktop feature.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
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
    fs.appendFileSync(STARTUP_TIMELINE_PATH, `${new Date().toISOString()} +${elapsedMs}ms ${name}\n`);
  } catch {
    // Best-effort diagnostics; must never break startup itself.
  }
}
recordStartupMilestone("electron-process-start");

let mainWindow = null;
let backendProcess = null;
let isQuitting = false;
let backendRestartTimer = null;
let backendStopRequested = false;
let backendRestartAttempts = 0;
let backendStableTimer = null;
let backendDuplicateWatchTimer = null;
let backendDuplicateDetected = false;
let backendDuplicateWatchGeneration = 0;
const BACKEND_STABLE_RESET_MS = 30_000;
const BACKEND_DUPLICATE_WATCH_MS = 5_000;
const BACKEND_API_TOKEN =
  process.env.SONGAPP_API_TOKEN || crypto.randomBytes(32).toString("base64url");
let runtimeBackendUrl = BACKEND_URL;
let runtimeBackendHost = BACKEND_HOST;
let runtimeBackendPort = BACKEND_PORT;

async function configureRuntimeBackendEndpoint() {
  const endpoint = await chooseRuntimeBackendEndpoint({
    isDev,
    explicitUrl: process.env.KARAOKE_BACKEND_URL,
    defaultUrl: BACKEND_URL
  });
  runtimeBackendUrl = endpoint.url;
  runtimeBackendHost = endpoint.host;
  runtimeBackendPort = endpoint.port;
}

function packagedBackendDataDir() {
  return isDev ? null : path.join(INSTALL_DATA_ROOT, "backend");
}

function resolvePackagedBackendDataDir() {
  return packagedBackendDataDir();
}

function resolveBackendDir() {
  // В dev-режиме backend лежит рядом с проектом (../backend при обычной
  // раскладке репозитория). В собранном приложении ожидаем, что backend
  // упакован рядом с ресурсами — см. README.md о сборке инсталлятора:
  // это то место, которое нужно донастроить под конкретный способ
  // распространения (PyInstaller-бинарник backend'а и т.п.).
  if (isDev) return path.resolve(__dirname, "..", "..", "backend");
  return path.join(process.resourcesPath, "backend");
}

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

function requestBackendJson(pathname, timeoutMs = BACKEND_REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      `${runtimeBackendUrl}${pathname}`,
      { headers: { "X-ADVoice-Token": BACKEND_API_TOKEN } },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          if (body.length < 1024 * 1024) body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Backend returned HTTP ${response.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("Backend request timed out"));
    });
    request.on("error", reject);
  });
}

// Folds Electron main-process errors into the same application.log file the
// Python backend and renderer already report to, instead of leaving them
// only in this process's own stdout. Best-effort: the backend is not always
// reachable when these fire (e.g. the backend itself failed to start), so
// failures here are swallowed rather than compounding the original error.
function reportBackendError(message, stack) {
  try {
    const body = JSON.stringify({ source: "electron-main", level: "error", message, stack });
    const request = http.request(
      `${runtimeBackendUrl}/diagnostics/client-log`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-ADVoice-Token": BACKEND_API_TOKEN,
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: 2000
      },
      (response) => response.resume()
    );
    request.on("error", () => {});
    request.on("timeout", () => request.destroy());
    request.end(body);
  } catch {
    // Never let error reporting itself throw.
  }
}

async function resolveSongOutputDir() {
  try {
    const settings = await requestBackendJson("/settings");
    const configuredPath = settings?.songs_folder;
    if (typeof configuredPath === "string" && configuredPath.trim()) {
      return path.resolve(configuredPath.trim());
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      "Не удалось получить папку библиотеки от backend, используется путь по умолчанию:",
      error?.message || error
    );
  }

  if (isDev) return path.resolve(resolveBackendDir(), "..", "karaoke_songs");
  return path.join(resolvePackagedBackendDataDir(), "karaoke_songs");
}

function isPathInside(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function scheduleBackendRestart() {
  if (
    isQuitting ||
    backendStopRequested ||
    backendDuplicateDetected ||
    process.env.KARAOKE_BACKEND_EXTERNAL === "1"
  ) {
    return;
  }

  clearTimeout(backendRestartTimer);
  const delay = Math.min(
    BACKEND_RESTART_MAX_DELAY_MS,
    BACKEND_RESTART_BASE_DELAY_MS * 2 ** Math.min(backendRestartAttempts, 5)
  );
  backendRestartAttempts += 1;
  backendRestartTimer = setTimeout(startBackend, delay);
}

function watchDuplicateBackend() {
  backendDuplicateDetected = true;
  const generation = ++backendDuplicateWatchGeneration;
  clearTimeout(backendDuplicateWatchTimer);
  const active = () =>
    generation === backendDuplicateWatchGeneration &&
    !isQuitting &&
    !backendStopRequested &&
    backendDuplicateDetected;
  const check = async () => {
    if (!active()) return;
    try {
      await requestBackendJson("/settings", Math.min(BACKEND_REQUEST_TIMEOUT_MS, 3000));
      if (active()) backendDuplicateWatchTimer = setTimeout(check, BACKEND_DUPLICATE_WATCH_MS);
    } catch {
      if (!active()) return;
      backendDuplicateDetected = false;
      backendDuplicateWatchTimer = null;
      startBackend();
    }
  };
  backendDuplicateWatchTimer = setTimeout(check, BACKEND_DUPLICATE_WATCH_MS);
}

function startBackend() {
  if (
    isQuitting ||
    backendStopRequested ||
    process.env.KARAOKE_BACKEND_EXTERNAL === "1" ||
    (backendProcess && !backendProcess.killed)
  ) {
    return;
  }
  clearTimeout(backendRestartTimer);
  backendRestartTimer = null;
  backendStopRequested = false;
  const backendDir = resolveBackendDir();
  const backendCommand = isDev
    ? process.env.KARAOKE_PYTHON || (IS_WINDOWS ? "python" : "python3")
    : path.join(backendDir, IS_WINDOWS ? "KaraokeBackend.exe" : "KaraokeBackend");
  const backendArgs = isDev ? ["run.py"] : [];
  const backendDataDir = isDev ? null : resolvePackagedBackendDataDir();
  const backendLogDir = isDev
    ? path.resolve(__dirname, "..", "..", "generated", "logs")
    : INSTALL_LOG_DIR;
  const packagedModelsDir = isDev ? null : path.join(INSTALL_DATA_ROOT, "models");
  const packagedCacheDir = isDev ? null : path.join(INSTALL_DATA_ROOT, "cache");
  const packagedDownloadsDir = isDev ? null : path.join(INSTALL_DATA_ROOT, "downloads");

  try {
    const childProcess = spawn(backendCommand, backendArgs, {
      cwd: backendDir,
      // run.py already writes backend, renderer and Electron diagnostics to
      // application.log; redirecting the child created a duplicate log stream.
      stdio: isDev ? "inherit" : "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        ...(backendDataDir
          ? {
              SONGAPP_INSTALL_ROOT: INSTALL_ROOT,
              SONGAPP_DATA_DIR: backendDataDir,
              SONGAPP_MODELS_DIR: packagedModelsDir,
              SONGAPP_CACHE_DIR: packagedCacheDir,
              SONGAPP_DOWNLOADS_DIR: packagedDownloadsDir,
              HF_HOME: path.join(packagedCacheDir, "huggingface"),
              HF_HUB_CACHE: path.join(packagedCacheDir, "huggingface", "hub"),
              TORCH_HOME: path.join(packagedCacheDir, "torch"),
              NUMBA_CACHE_DIR: path.join(packagedCacheDir, "numba"),
              MPLCONFIGDIR: path.join(packagedCacheDir, "matplotlib")
            }
          : {}),
        SONGAPP_HOST: runtimeBackendHost,
        SONGAPP_PORT: String(runtimeBackendPort),
        SONGAPP_LOG_DIR: backendLogDir,
        SONGAPP_API_TOKEN: BACKEND_API_TOKEN,
        ...(isDev ? {} : { SONGAPP_CORS_ORIGINS: "null" }),
        // Packaged ffmpeg.exe is placed next to KaraokeBackend.exe.
        PATH: `${backendDir}${path.delimiter}${process.env.PATH || ""}`
      }
    });
    backendProcess = childProcess;
    childProcess.once("spawn", () => {
      recordStartupMilestone("backend-spawn");
      clearTimeout(backendStableTimer);
      backendStableTimer = setTimeout(() => {
        if (backendProcess === childProcess) backendRestartAttempts = 0;
      }, BACKEND_STABLE_RESET_MS);
    });
    childProcess.on("error", (err) => {
      clearTimeout(backendStableTimer);
      backendStableTimer = null;
      console.error("Не удалось запустить backend:", err);
      reportBackendError("Не удалось запустить backend", err?.stack || String(err));
      if (backendProcess === childProcess) backendProcess = null;
      scheduleBackendRestart();
    });
    childProcess.on("exit", (code, signal) => {
      clearTimeout(backendStableTimer);
      backendStableTimer = null;
      if (backendProcess === childProcess) backendProcess = null;
      if (code === 23) {
        // Another healthy backend owns the port. Watch it instead of either
        // restart-looping or disabling self-healing for the whole app lifetime.
        watchDuplicateBackend();
        return;
      }
      if (isQuitting || backendStopRequested || process.env.KARAOKE_BACKEND_EXTERNAL === "1") {
        return;
      }
      const message = `Backend stopped (${code ?? "unknown"}, ${signal ?? "no signal"}); restarting…`;
      console.error(message);
      reportBackendError(message);
      scheduleBackendRestart();
    });
  } catch (err) {
    backendProcess = null;
    console.error("Не удалось запустить backend:", err);
    reportBackendError("Не удалось запустить backend", err?.stack || String(err));
    scheduleBackendRestart();
  }
}

function stopBackend() {
  if (backendStopRequested) return;
  backendStopRequested = true;
  clearTimeout(backendRestartTimer);
  clearTimeout(backendStableTimer);
  clearTimeout(backendDuplicateWatchTimer);
  backendStableTimer = null;
  backendDuplicateWatchTimer = null;
  backendDuplicateDetected = false;
  backendDuplicateWatchGeneration += 1;

  const terminateBackend = () => {
    if (backendProcess && !backendProcess.killed) {
      const { pid } = backendProcess;
      backendProcess.kill();
      if (IS_WINDOWS && pid) {
        // PyInstaller/native workers can outlive a soft child kill; terminate
        // the whole process tree on app shutdown.
        spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
      }
      backendProcess = null;
    }
  };

  // Ask any in-progress AI processing to cancel cooperatively before the
  // grace period below force-kills the process tree, so it has a chance to
  // reach a clean cancelled state instead of being cut off mid-write.
  // Best-effort/fire-and-forget: doesn't gate the shutdown timeline below.
  const shutdownRequest = http.request(`${runtimeBackendUrl}/diagnostics/shutdown`, {
    method: "POST",
    timeout: 450,
    headers: { "X-ADVoice-Token": BACKEND_API_TOKEN }
  });
  shutdownRequest.on("response", (response) => response.resume());
  shutdownRequest.on("error", () => {});
  shutdownRequest.on("timeout", () => shutdownRequest.destroy());
  shutdownRequest.end();

  // Release the native audio worker before terminating Python. On Windows a
  // direct child-process kill can otherwise leave an isolated monitor holding
  // the microphone for a short time after the application has closed.
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    terminateBackend();
  };
  const request = http.request(`${runtimeBackendUrl}/audio/direct-monitor/stop`, {
    method: "POST",
    timeout: 450,
    headers: { "X-ADVoice-Token": BACKEND_API_TOKEN }
  });
  request.on("response", (response) => {
    response.resume();
    response.once("end", finish);
  });
  request.on("error", finish);
  request.on("timeout", () => {
    request.destroy();
    finish();
  });
  request.end();
  setTimeout(finish, BACKEND_STOP_GRACE_MS);
}
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
  if (!isDev) storeIconTheme(initialTheme);
  mainWindow = new BrowserWindow({
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    fullscreen: true,
    icon: getThemeIcon(initialTheme),

    backgroundColor: "#0d0a1a",
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
        `--advoice-backend-url=${runtimeBackendUrl}`
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

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
    const allowed = isAllowedRendererUrl(navigationUrl, {
      isDev,
      devOrigin: DEV_RENDERER_ORIGIN,
      packagedIndexUrl
    });
    if (!allowed) event.preventDefault();
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  const loadPromise = isDev
    ? mainWindow.loadURL(DEV_RENDERER_ORIGIN)
    : mainWindow.loadFile(packagedIndexPath);
  loadPromise.catch((error) => {
    console.error("Не удалось загрузить интерфейс:", error);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });

  mainWindow.on("closed", () => {
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
  event.returnValue = isTrustedIpcEvent(event, mainWindow?.webContents)
    ? BACKEND_API_TOKEN
    : "";
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

const RENDERER_STARTUP_MILESTONES = new Set(["backend-healthy", "app-interactive"]);
handleTrustedIpc("startup:milestone", (name) => {
  if (!RENDERER_STARTUP_MILESTONES.has(name)) return false;
  recordStartupMilestone(name);
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
    runtimeBackendUrl,
    BACKEND_API_TOKEN
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
