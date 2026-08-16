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
// Keep the development profile self-contained. It avoids Windows profile
// permission/cache corruption from making `start-dev.bat` look like a broken
// app launch. Packaged builds continue to use the normal per-user profile.
if (isDev) {
  app.setPath(
    "userData",
    process.env.KARAOKE_ELECTRON_PROFILE ||
      path.resolve(__dirname, "..", ".runtime", "electron-profile")
  );
}

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
const BACKEND_API_TOKEN = crypto.randomBytes(32).toString("base64url");
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
  if (isDev) return null;
  if (IS_WINDOWS && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "A&D Voice", "backend-data");
  }
  return path.join(app.getPath("userData"), "backend-data");
}

function backendDataHasPersistentState(directory) {
  if (!directory || !fs.existsSync(directory)) return false;
  return (
    fs.existsSync(path.join(directory, "app.db")) ||
    fs.existsSync(path.join(directory, "karaoke_songs")) ||
    fs.existsSync(path.join(directory, "path-settings.json"))
  );
}

function resolvePackagedBackendDataDir() {
  const preferred = packagedBackendDataDir();
  if (!preferred || isDev) return preferred;
  const legacy = path.join(app.getPath("userData"), "backend-data");
  if (path.resolve(preferred) === path.resolve(legacy) || !backendDataHasPersistentState(legacy)) {
    return preferred;
  }
  // A previous installer may already have seeded only settings.json in the new
  // LocalAppData directory. That must not hide a real legacy DB/library.
  if (backendDataHasPersistentState(preferred)) return preferred;
  try {
    if (fs.existsSync(preferred)) {
      const entries = fs.readdirSync(preferred);
      const seedOnly = entries.every((name) => name === "settings.json");
      if (!seedOnly) return legacy;
      fs.rmSync(preferred, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(preferred), { recursive: true });
    fs.renameSync(legacy, preferred);
    return preferred;
  } catch (error) {
    // Existing installs may already contain a large library. Never copy it
    // synchronously during startup; keep using the legacy location rather than
    // making the user's songs disappear if a policy/volume blocks the move.
    console.error(
      "Could not migrate backend data from Roaming to LocalAppData; using legacy location:",
      error?.message || error
    );
    return legacy;
  }
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
    ? path.resolve(__dirname, "..", "..", "logs")
    : path.join(app.getPath("userData"), "logs");

  let backendLogFd = null;
  try {
    if (!isDev) {
      fs.mkdirSync(backendLogDir, { recursive: true });
      backendLogFd = fs.openSync(path.join(backendLogDir, "backend-process.log"), "a");
      fs.writeSync(backendLogFd, `\n\n===== backend start ${new Date().toISOString()} =====\n`);
    }

    const childProcess = spawn(backendCommand, backendArgs, {
      cwd: backendDir,
      // In development inherit the terminal. In the installed application keep
      // stdout/stderr in a persistent file instead of discarding the traceback.
      stdio: isDev ? "inherit" : ["ignore", backendLogFd, backendLogFd],
      windowsHide: true,
      env: {
        ...process.env,
        ...(backendDataDir ? { SONGAPP_DATA_DIR: backendDataDir } : {}),
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
      clearTimeout(backendStableTimer);
      backendStableTimer = setTimeout(() => {
        if (backendProcess === childProcess) backendRestartAttempts = 0;
      }, BACKEND_STABLE_RESET_MS);
      if (backendLogFd !== null) {
        fs.closeSync(backendLogFd);
        backendLogFd = null;
      }
    });
    childProcess.on("error", (err) => {
      clearTimeout(backendStableTimer);
      backendStableTimer = null;
      console.error("Не удалось запустить backend:", err);
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
      console.error(
        `Backend stopped (${code ?? "unknown"}, ${signal ?? "no signal"}); restarting…`
      );
      scheduleBackendRestart();
    });
  } catch (err) {
    if (backendLogFd !== null) {
      try {
        fs.writeSync(backendLogFd, `${err?.stack || err}\n`);
        fs.closeSync(backendLogFd);
      } catch {
        // Ignore secondary logging failures while reporting the real startup error.
      }
      backendLogFd = null;
    }
    backendProcess = null;
    console.error("Не удалось запустить backend:", err);
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
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    frame: false,

    icon: getThemeIcon(initialTheme),

    backgroundColor: "#0d0a1a",
    show: false,

    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [
        `--advoice-theme=${initialTheme}`,
        `--advoice-backend-url=${runtimeBackendUrl}`,
        `--advoice-api-token=${BACKEND_API_TOKEN}`
      ]
    }
  });
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
    mainWindow?.setFullScreen(true);
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
}

function handleTrustedIpc(channel, handler) {
  registerTrustedIpc(ipcMain, channel, () => mainWindow?.webContents, handler);
}

handleTrustedIpc("window:minimize", () => mainWindow?.minimize());
handleTrustedIpc("window:maximize", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
handleTrustedIpc("window:close", () => mainWindow?.close());
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
