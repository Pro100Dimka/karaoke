const { contextBridge, ipcRenderer } = require("electron");

const argumentValue = (name) =>
  process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const initialTheme = argumentValue("advoice-theme");
const backendUrl = argumentValue("advoice-backend-url");
// Fetched over IPC rather than a launch argument -- CLI arguments are part
// of this renderer process's own OS command line, visible to any other
// process on the machine, not just this window's JS.
const apiToken = ipcRenderer.sendSync("advoice:get-api-token") || undefined;

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
  onHardwareSuspensionChange: (callback) => {
    const listener = (_event, suspended) => callback(Boolean(suspended));
    ipcRenderer.on("app:hardware-suspension-changed", listener);
    return () => ipcRenderer.removeListener("app:hardware-suspension-changed", listener);
  },

  openSongFolder: (song) => ipcRenderer.invoke("shell:openSongFolder", song),
  openApplicationLog: () => ipcRenderer.invoke("shell:openApplicationLog"),

  selectFolder: (currentPath) => ipcRenderer.invoke("dialog:selectFolder", currentPath),

  getSceneVideoUrl: () => "karaoke-media://scene/main",

  copyText: (value) => ipcRenderer.invoke("clipboard:writeText", value),

  setIconTheme: (theme) => ipcRenderer.invoke("window:setIconTheme", theme),
  configureLighting: (enabled) => ipcRenderer.invoke("lighting:configure", enabled),
  sendLightingFrame: (frame) => ipcRenderer.invoke("lighting:frame", frame),
  getLightingStatus: () => ipcRenderer.invoke("lighting:status"),

  recordStartupMilestone: (name) => ipcRenderer.invoke("startup:milestone", name),

  isElectron: true
});
