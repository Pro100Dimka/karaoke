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
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const isDev = !app.isPackaged;
const BACKEND_URL = "http://127.0.0.1:8000";

let mainWindow = null;
let backendProcess = null;
let isQuitting = false;
let backendRestartTimer = null;

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

function startBackend() {
  if (process.env.KARAOKE_BACKEND_EXTERNAL === "1") return;
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
      stdio: "ignore",
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
  clearTimeout(backendRestartTimer);
  // Release a monitor even when development uses an external backend.
  const request = http.request(`${BACKEND_URL}/audio/direct-monitor/stop`, {
    method: "POST",
    timeout: 500,
  });
  request.on("error", () => {});
  request.end();
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
    backendProcess = null;
  }
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
ipcMain.handle("shell:openPath", (_event, targetPath) => shell.openPath(targetPath));
ipcMain.handle("backend:url", () => BACKEND_URL);

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
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
