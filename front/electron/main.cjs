// Electron main-процесс.
//
// Отвечает за:
//  1) создание окна приложения (безрамочное — свой titlebar в React,
//     как на референсе со скриншота: кнопки свернуть/развернуть/закрыть);
//  2) запуск python-backend (uvicorn) как дочернего процесса при старте
//     программы и его остановку при закрытии — пользователь просто
//     запускает "Karaoke Studio", ему не нужно отдельно поднимать backend;
//  3) IPC-мостик для управления окном и открытия папки песни в проводнике.
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

const isDev = !app.isPackaged;
const BACKEND_URL = "http://127.0.0.1:8000";

let mainWindow = null;
let backendProcess = null;

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
  const backendDir = resolveBackendDir();
  const pythonBin = process.platform === "win32" ? "python" : "python3";

  try {
    backendProcess = spawn(pythonBin, ["run.py"], {
      cwd: backendDir,
      stdio: "ignore",
      windowsHide: true,
    });
    backendProcess.on("error", (err) => {
      console.error("Не удалось запустить backend:", err);
    });
  } catch (err) {
    console.error("Не удалось запустить backend:", err);
  }
}

function stopBackend() {
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
    mainWindow.webContents.openDevTools({ mode: "detach" });
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
  startBackend();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopBackend();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", stopBackend);
