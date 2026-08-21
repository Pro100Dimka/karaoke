const { contextBridge, ipcRenderer } = require("electron");

const argumentValue = (name) =>
  process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const initialTheme = argumentValue("advoice-theme");
const backendUrl = argumentValue("advoice-backend-url");
const apiToken = argumentValue("advoice-api-token");

contextBridge.exposeInMainWorld("electronAPI", {
  initialTheme,
  backendUrl,
  apiToken,
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  toggleFullscreen: () => ipcRenderer.invoke("window:toggleFullscreen"),
  onFullscreenChange: (callback) => {
    const listener = (_event, isFullScreen) => callback(isFullScreen);
    ipcRenderer.on("window:fullscreen-changed", listener);
    return () => ipcRenderer.removeListener("window:fullscreen-changed", listener);
  },

  openSongFolder: (song) => ipcRenderer.invoke("shell:openSongFolder", song),
  openApplicationLog: () => ipcRenderer.invoke("shell:openApplicationLog"),

  selectFolder: (currentPath) => ipcRenderer.invoke("dialog:selectFolder", currentPath),

  getSceneVideoUrl: () => "karaoke-media://scene/main",

  copyText: (value) => ipcRenderer.invoke("clipboard:writeText", value),

  setIconTheme: (theme) => ipcRenderer.invoke("window:setIconTheme", theme),

  isElectron: true
});
