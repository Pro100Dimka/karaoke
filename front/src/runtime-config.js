const positiveNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

const pollingScale = positiveNumber(import.meta.env.VITE_POLLING_SCALE, 1);
const interval = (milliseconds) =>
  Math.max(16, Math.round(milliseconds * pollingScale));

export const API_BASE_URL = String(
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

export const BACKEND_BOOT_RETRY_MS = positiveNumber(
  import.meta.env.VITE_BACKEND_RETRY_MS,
  450
);

export const POLLING_INTERVALS = Object.freeze({
  realtimeSignal: interval(80),
  processing: interval(1000),
  modelDownload: interval(1500),
  karaokeSignal: interval(1200),
  health: interval(5000),
  history: interval(5000),
  memory: interval(5000),
  songs: interval(8000),
  errors: interval(8000),
  about: interval(10000),
  freeSpace: interval(10000),
  versions: interval(15000),
  settings: interval(15000),
  devices: interval(30000)
});
