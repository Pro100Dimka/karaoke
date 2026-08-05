export function clampFinite(value, min, max, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function normalizeAudioDuration(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function normalizeAudioPosition(value, duration = null) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  if (duration == null) return number;
  const safeDuration = normalizeAudioDuration(duration);
  return safeDuration ? Math.min(number, safeDuration) : 0;
}

export function normalizeAudioVolume(value) {
  if (
    value == null ||
    typeof value === "boolean" ||
    (typeof value === "string" && !value.trim()) ||
    typeof value === "object"
  ) {
    return 1;
  }
  return clampFinite(value, 0, 1, 1);
}

export function formatAudioTime(seconds) {
  const value = normalizeAudioPosition(seconds);
  const minutes = Math.floor(value / 60);
  const remainder = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export async function toggleAudioPlayback(audio) {
  if (!audio) return false;

  if (!audio.paused) {
    audio.pause();
    return false;
  }

  try {
    await audio.play();
    return true;
  } catch {
    return false;
  }
}
