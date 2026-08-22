const positive = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};
const scale = positive(import.meta.env.VITE_POLLING_SCALE, 1);
const interval = (milliseconds) => Math.max(16, Math.round(milliseconds * scale));

export const API_BASE_URL = String(
  globalThis.electronAPI?.backendUrl || import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");
export const BACKEND_BOOT_RETRY_MS = positive(import.meta.env.VITE_BACKEND_RETRY_MS, 450);
export const POLLING_INTERVALS = Object.freeze(
  Object.fromEntries(
    Object.entries({
      realtimeSignal: 80,
      processing: 1000,
      modelDownload: 1500,
      karaokeSignal: 1200,
      health: 5000,
      history: 5000,
      memory: 5000,
      songs: 8000,
      errors: 8000,
      about: 10000,
      freeSpace: 10000,
      versions: 15000,
      settings: 15000,
      devices: 30000
    }).map(([key, value]) => [key, interval(value)])
  )
);
