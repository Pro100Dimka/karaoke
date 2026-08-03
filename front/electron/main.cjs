// Electron main-процесс.
//
// Отвечает за:
//  1) создание окна приложения (безрамочное — свой titlebar в React,
//     как на референсе со скриншота: кнопки свернуть/развернуть/закрыть);
//  2) запуск python-backend (uvicorn) как дочернего процесса при старте
//     программы и его остановку при закрытии — пользователь просто
//     запускает "Karaoke Studio", ему не нужно отдельно поднимать backend;
//  3) IPC-мостик для управления окном и открытия папки песни в проводнике.
const { app, BrowserWindow, ipcMain, session, shell } = require("electron");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const isDev = !app.isPackaged;
const BACKEND_URL = "http://127.0.0.1:8000";

// Keep the development profile self-contained. It avoids Windows profile
// permission/cache corruption from making `start-dev.bat` look like a broken
// app launch. Packaged builds continue to use the normal per-user profile.
if (isDev) {
  app.setPath(
    "userData",
    process.env.KARAOKE_ELECTRON_PROFILE ||
      path.resolve(__dirname, "..", ".runtime", "electron-profile"),
  );
}

let mainWindow = null;
let backendProcess = null;
let isQuitting = false;
let backendRestartTimer = null;
let backendStopRequested = false;

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
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function startBackend() {
  if (process.env.KARAOKE_BACKEND_EXTERNAL === "1") return;
  backendStopRequested = false;
  const backendDir = resolveBackendDir();
  const backendCommand = isDev
    ? (process.env.KARAOKE_PYTHON || (process.platform === "win32" ? "python" : "python3"))
    : path.join(backendDir, process.platform === "win32" ? "KaraokeBackend.exe" : "KaraokeBackend");
  const backendArgs = isDev ? ["run.py"] : [];
  const backendDataDir = isDev ? null : path.join(app.getPath("userData"), "backend-data");
  const backendLogDir = isDev ? path.resolve(__dirname, "..", "..", "logs") : path.join(app.getPath("userData"), "logs");

  try {
    backendProcess = spawn(backendCommand, backendArgs, {
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
        PATH: `${backendDir}${path.delimiter}${process.env.PATH || ""}`,
      },
    });
    backendProcess.on("error", (err) => {
      console.error("Не удалось запустить backend:", err);
    });
    backendProcess.on("exit", (code, signal) => {
      backendProcess = null;
      if (isQuitting || process.env.KARAOKE_BACKEND_EXTERNAL === "1") return;
      console.error(`Backend stopped (${code ?? "unknown"}, ${signal ?? "no signal"}); restarting…`);
      clearTimeout(backendRestartTimer);
      backendRestartTimer = setTimeout(startBackend, 1200);
    });
  } catch (err) {
    console.error("Не удалось запустить backend:", err);
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
    timeout: 450,
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
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.handle("window:minimize", () => mainWindow?.minimize());
ipcMain.handle("window:maximize", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle("window:close", () => mainWindow?.close());
ipcMain.handle("shell:openSongFolder", (_event, targetPath) => {
  if (typeof targetPath !== "string" || !targetPath) {
    return "A song folder was not provided.";
  }

  let songsDir;
  let folderPath;
  try {
    // Resolve links before the containment check: a link inside Song/ must
    // not become an indirect way to open arbitrary folders from the renderer.
    songsDir = fs.realpathSync.native(resolveSongOutputDir());
    folderPath = fs.realpathSync.native(targetPath);
  } catch {
    return "The song folder is no longer available.";
  }
  if (!isPathInside(songsDir, folderPath)) {
    return "Opening folders outside the song library is not allowed.";
  }
  return shell.openPath(folderPath);
});
ipcMain.handle("backend:url", () => BACKEND_URL);

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestUrl = details?.requestingUrl || "";
    const trustedRenderer = webContents === mainWindow?.webContents
      && (requestUrl.startsWith("file://") || requestUrl.startsWith("http://127.0.0.1:5173"));
    // The app uses only the microphone. Never grant media permissions to a
    // navigation, popup, or arbitrary origin that happens to share a session.
    callback(permission === "media" && trustedRenderer);
  });
  startBackend();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  isQuitting = true;
  stopBackend();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  stopBackend();
});
