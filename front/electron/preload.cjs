const { contextBridge, ipcRenderer } = require("electron");

const initialTheme = process.argv
  .find((argument) => argument.startsWith("--advoice-theme="))
  ?.slice("--advoice-theme=".length);

contextBridge.exposeInMainWorld("electronAPI", {
  initialTheme,
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),

  openSongFolder: (song) => ipcRenderer.invoke("shell:openSongFolder", song),

  selectFolder: (currentPath) =>
    ipcRenderer.invoke("dialog:selectFolder", currentPath),

  getBackendUrl: () => ipcRenderer.invoke("backend:url"),

  getSceneVideoUrl: () => "karaoke-media://scene/main",

  copyText: (value) => ipcRenderer.invoke("clipboard:writeText", value),

  setIconTheme: (theme) => ipcRenderer.invoke("window:setIconTheme", theme),

  isElectron: true
});
