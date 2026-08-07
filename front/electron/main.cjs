// Electron main-процесс.
//
// Отвечает за:
//  1) создание окна приложения (безрамочное — свой titlebar в React,
//     как на референсе со скриншота: кнопки свернуть/развернуть/закрыть);
//  2) запуск python-backend (uvicorn) как дочернего процесса при старте
//     программы и его остановку при закрытии — пользователь просто
//     запускает "Karaoke Studio", ему не нужно отдельно поднимать backend;
//  3) IPC-мостик для управления окном и открытия папки песни в проводнике.
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");
const {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  session,
  shell
} = require("electron");

const {
  getPackagedRendererUrl,
  isAllowedPermissionRequest,
  isAllowedRendererUrl,
  isTrustedIpcEvent
} = require("./security.cjs");
const { findMatchingSongFolder } = require("./song-folders.cjs");

// Background radio is an intentional desktop feature.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const isDev = !app.isPackaged;
const BACKEND_URL = "http://127.0.0.1:8000";
const DEV_RENDERER_ORIGIN = "http://127.0.0.1:5173";

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
const MAX_BACKEND_RESTART_DELAY_MS = 30_000;

function resolveBackendDir() {
  // В dev-режиме backend лежит рядом с проектом (../backend при обычной
  // раскладке репозитория). В собранном приложении ожидаем, что backend
  // упакован рядом с ресурсами — см. README.md о сборке инсталлятора:
  // это то место, которое нужно донастроить под конкретный способ
  // распространения (PyInstaller-бинарник backend'а и т.п.).
  if (isDev) {
    return path.resolve(__dirname, "..", "..", "backend");
  }
  return path.join(process.resourcesPath, "backend");
}

function resolveSongOutputDir() {
  if (isDev) return path.join(resolveBackendDir(), "Song");
  return path.join(app.getPath("userData"), "backend-data", "Song");
}

function isPathInside(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function scheduleBackendRestart() {
  if (
    isQuitting ||
    backendStopRequested ||
    process.env.KARAOKE_BACKEND_EXTERNAL === "1"
  ) {
    return;
  }

  clearTimeout(backendRestartTimer);
  const delay = Math.min(
    MAX_BACKEND_RESTART_DELAY_MS,
    1200 * 2 ** Math.min(backendRestartAttempts, 5)
  );
  backendRestartAttempts += 1;
  backendRestartTimer = setTimeout(startBackend, delay);
}

function startBackend() {
  if (
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
    ? process.env.KARAOKE_PYTHON ||
      (process.platform === "win32" ? "python" : "python3")
    : path.join(
        backendDir,
        process.platform === "win32" ? "KaraokeBackend.exe" : "KaraokeBackend"
      );
  const backendArgs = isDev ? ["run.py"] : [];
  const backendDataDir = isDev
    ? null
    : path.join(app.getPath("userData"), "backend-data");
  const backendLogDir = isDev
    ? path.resolve(__dirname, "..", "..", "logs")
    : path.join(app.getPath("userData"), "logs");

  try {
    const childProcess = spawn(backendCommand, backendArgs, {
      cwd: backendDir,
      // Keep the packaged app quiet, but expose backend startup errors in the
      // terminal launched by start-dev.bat. Otherwise a missing dependency or
      // a port conflict looks like a frontend failure with no useful clue.
      stdio: isDev ? "inherit" : "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        ...(backendDataDir ? { SONGAPP_DATA_DIR: backendDataDir } : {}),
        SONGAPP_LOG_DIR: backendLogDir,
        // Packaged ffmpeg.exe is placed next to KaraokeBackend.exe.
        PATH: `${backendDir}${path.delimiter}${process.env.PATH || ""}`
      }
    });
    backendProcess = childProcess;
    childProcess.once("spawn", () => {
      backendRestartAttempts = 0;
    });
    childProcess.on("error", (err) => {
      console.error("Не удалось запустить backend:", err);
      if (backendProcess === childProcess) backendProcess = null;
      scheduleBackendRestart();
    });
    childProcess.on("exit", (code, signal) => {
      if (backendProcess === childProcess) backendProcess = null;
      if (
        isQuitting ||
        backendStopRequested ||
        process.env.KARAOKE_BACKEND_EXTERNAL === "1"
      ) {
        return;
      }
      console.error(
        `Backend stopped (${code ?? "unknown"}, ${signal ?? "no signal"}); restarting…`
      );
      scheduleBackendRestart();
    });
  } catch (err) {
    backendProcess = null;
    console.error("Не удалось запустить backend:", err);
    scheduleBackendRestart();
  }
}

function stopBackend() {
  if (backendStopRequested) return;
  backendStopRequested = true;
  clearTimeout(backendRestartTimer);

  const terminateBackend = () => {
    if (backendProcess && !backendProcess.killed) {
      backendProcess.kill();
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
  const request = http.request(`${BACKEND_URL}/audio/direct-monitor/stop`, {
    method: "POST",
    timeout: 450
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
  setTimeout(finish, 550);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    frame: false, // свой titlebar — см. src/components/TitleBar.jsx
    backgroundColor: "#0d0a1a",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

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
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedIpcEvent(event, mainWindow?.webContents)) {
      throw new Error(`Rejected IPC request: ${channel}`);
    }
    return handler(...args);
  });
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
  const songsDir = resolveSongOutputDir();
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
      const error = await shell.openPath(
        path.join(realSongsDir, matchingEntry.name)
      );
      return error || "";
    }
  } catch {
    // Fall through to the user-facing error.
  }

  return "Папка песни не найдена.";
});
handleTrustedIpc("backend:url", () => BACKEND_URL);
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

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  const packagedIndexUrl = getPackagedRendererUrl(
    path.join(__dirname, "..", "dist", "index.html")
  );
  const rendererOptions = {
    isDev,
    devOrigin: DEV_RENDERER_ORIGIN,
    packagedIndexUrl
  };
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
      callback(
        permissionAllowed(
          webContents,
          permission,
          details?.requestingUrl,
          details
        )
      );
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
