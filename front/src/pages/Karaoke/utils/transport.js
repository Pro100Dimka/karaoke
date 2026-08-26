import { generateId } from "../../../utils/id";
import { clamp } from "../../../utils/math";

export function clampPlaybackPosition(time, duration) {
  const value = Number(time);
  const limit = Number(duration);
  const safeValue = Number.isFinite(value) ? value : 0;

  if (!Number.isFinite(limit) || limit <= 0) return Math.max(0, safeValue);

  return clamp(safeValue, 0, limit);
}

// A single 80ms hard-seek threshold made every small drift (a scheduling
// hiccup, a rAF frame skip) visible/audible as a seek. Below ~20ms nothing
// is done at all (imperceptible); 20-250ms nudges playbackRate by a small,
// barely-perceptible amount toward the target instead of jumping to it;
// only beyond 250ms -- where a rate nudge would take too long to catch up --
// does it fall back to a hard seek.
export const DRIFT_THRESHOLDS_SEC = Object.freeze({ none: 0.02, soft: 0.08, strong: 0.25 });
const DRIFT_RATE_ADJUSTMENT = Object.freeze({ soft: 0.02, strong: 0.06 });

export function classifyDrift(driftSeconds) {
  const magnitude = Math.abs(Number(driftSeconds) || 0);
  if (magnitude <= DRIFT_THRESHOLDS_SEC.none) return "none";
  if (magnitude <= DRIFT_THRESHOLDS_SEC.soft) return "soft";
  if (magnitude <= DRIFT_THRESHOLDS_SEC.strong) return "strong";
  return "hard";
}

// driftSeconds is currentTime - target: negative means the media is behind
// and needs to speed up, positive means it is ahead and needs to slow down.
export function driftCorrectedRate(
  baseRate,
  driftSeconds,
  classification = classifyDrift(driftSeconds)
) {
  const safeBase = Number.isFinite(baseRate) && baseRate > 0 ? baseRate : 1;
  const adjustment = DRIFT_RATE_ADJUSTMENT[classification];
  if (!adjustment) return safeBase;
  const direction = driftSeconds < 0 ? 1 : -1;
  return safeBase * (1 + direction * adjustment);
}

export function getSecondaryMediaPosition(position, duration) {
  const target = Number(position);
  const limit = Number(duration);
  if (!Number.isFinite(target)) return 0;
  if (!Number.isFinite(limit) || limit <= 0) return Math.max(0, target);
  return clamp(target, 0, limit);
}

export function normalizePlaybackRate(speed) {
  const value = Number(speed);
  return Number.isFinite(value) && value > 0 ? clamp(value, 0.25, 4) : 1;
}

export function createPlayerSyncCommand(action, songId, position) {
  return {
    type: "karaoke-player",
    action,
    songId,
    position: Number.isFinite(Number(position)) ? Number(position) : 0,
    commandId: generateId()
  };
}

export function getMicrophoneLevel(signal) {
  const rmsDb = Number(signal?.rms_db ?? signal?.rms_dbfs);
  if (!Number.isFinite(rmsDb)) return 0;
  return clamp(((rmsDb + 60) / 60) * 100, 0, 100);
}
