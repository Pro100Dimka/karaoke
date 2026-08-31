// Single boundary for the Electron preload bridge (window.electronAPI). Feature
// code should call these named functions instead of touching
// globalThis.electronAPI/window.electronAPI directly, so a browser-only build
// (or a future non-Electron desktop shell) only needs to change this one file.
import { copyText } from "./clipboard";

const electronAPI = () => globalThis.electronAPI ?? globalThis.window?.electronAPI;

// clipboard.js already implements the electron IPC -> browser Clipboard API ->
// legacy execCommand fallback chain; re-exported here so it's discoverable
// alongside the rest of the platform boundary.
export const clipboard = copyText;

export const isElectron = () => electronAPI()?.isElectron === true;
export const configureLighting = (enabled) =>
  electronAPI()?.configureLighting?.(enabled) ??
  Promise.resolve({ state: "desktop_only", count: 0 });
export const sendLightingFrame = (frame) =>
  electronAPI()?.sendLightingFrame?.(frame) ?? Promise.resolve({ state: "desktop_only", count: 0 });
export const getLightingStatus = () =>
  electronAPI()?.getLightingStatus?.() ?? Promise.resolve({ state: "desktop_only", count: 0 });

export const apiToken = () => electronAPI()?.apiToken || import.meta.env.VITE_API_TOKEN;

export const backendUrl = () =>
  electronAPI()?.backendUrl || import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export const initialTheme = () => electronAPI()?.initialTheme;

export function setIconTheme(value) {
  electronAPI()?.setIconTheme?.(value);
}

export const windowActions = {
  minimize: () => electronAPI()?.minimize?.(),
  toggleFullscreen: () => electronAPI()?.toggleFullscreen?.(),
  close: () => electronAPI()?.close?.()
};

export function openApplicationLog() {
  electronAPI()?.openApplicationLog?.();
}

// Fire-and-forget: lets Electron's startup-timeline log (see main.cjs) record
// renderer-side milestones the main process can't observe on its own.
export function recordStartupMilestone(name) {
  electronAPI()
    ?.recordStartupMilestone?.(name)
    ?.catch?.(() => {});
}

// The scene backdrop video is the only "media URL" this bridge exposes today;
// kept under this general name so future media URL needs have one place to
// extend rather than growing more one-off electronAPI.getXUrl() methods.
export function mediaUrl() {
  return electronAPI()?.getSceneVideoUrl?.() || "";
}

export const canPickFolder = () => typeof electronAPI()?.selectFolder === "function";

export function pickFolder(...args) {
  return electronAPI()?.selectFolder?.(...args);
}

// Returns { supported: false } when the bridge doesn't exist at all (e.g. a
// browser build) so callers can show their own "desktop app only" messaging,
// or { supported: true, error } once it actually ran (error is falsy on success).
export async function openSongFolder(song) {
  const api = electronAPI();
  if (!api?.openSongFolder) return { supported: false, error: null };
  const error = await api.openSongFolder({
    path: song?.output_dir ?? "",
    slug: song?.slug ?? "",
    title: song?.title ?? "",
    id: song?.id ?? ""
  });
  return { supported: true, error };
}
