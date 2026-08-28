import { formatClockTime } from "../utils/time-format";

const number = (value) => Number(value);
export const clampFinite = (value, min, max, fallback = min) =>
  Number.isFinite(number(value)) ? Math.min(max, Math.max(min, number(value))) : fallback;
export const normalizeAudioDuration = (value) =>
  Number.isFinite(number(value)) && number(value) > 0 ? number(value) : 0;
export const normalizeAudioPosition = (value, duration = null) => {
  if (!Number.isFinite(number(value)) || number(value) <= 0) return 0;
  if (duration == null) return number(value);
  const limit = normalizeAudioDuration(duration);
  return limit ? Math.min(number(value), limit) : 0;
};
export const normalizeAudioVolume = (value) => {
  if (typeof value === "number") return clampFinite(value, 0, 1, 1);
  if (typeof value === "string") return value.trim() ? clampFinite(value, 0, 1, 1) : 1;
  return 1;
};
export const formatAudioTime = (value) => formatClockTime(value, { padMinutes: true });
const PLAY_START_TIMEOUT_MS = 1_200;
const tryPlay = async (audio) => {
  let timer;
  try {
    await Promise.race([
      Promise.resolve(audio.play()),
      new Promise((_, reject) => {
        timer = globalThis.setTimeout(
          () => reject(new Error("Audio playback start timed out")),
          PLAY_START_TIMEOUT_MS
        );
      })
    ]);
    return true;
  } finally {
    globalThis.clearTimeout(timer);
  }
};
export async function toggleAudioPlayback(audio) {
  if (!audio) return false;
  if (!audio.paused) {
    audio.pause();
    return false;
  }
  try {
    await tryPlay(audio);
    return true;
  } catch {
    // A freshly generated performance file can race Chromium's previous
    // metadata request, and switching a Bluetooth headset out of Hands-Free
    // may invalidate the existing media pipeline. Recreate it once rather
    // than leaving the Play button silently dead.
    try {
      audio.pause?.();
      audio.load?.();
      await tryPlay(audio);
      return true;
    } catch {
      return false;
    }
  }
}
