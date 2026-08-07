const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),

  openSongFolder: (song) => ipcRenderer.invoke("shell:openSongFolder", song),

  getBackendUrl: () => ipcRenderer.invoke("backend:url"),

  copyText: (value) => ipcRenderer.invoke("clipboard:writeText", value),

  setIconTheme: (theme) => ipcRenderer.invoke("window:setIconTheme", theme),

  isElectron: true
});
