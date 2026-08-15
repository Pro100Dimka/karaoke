const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function clampPlaybackPosition(time, duration) {
  const value = Number(time);
  const limit = Number(duration);
  const safeValue = Number.isFinite(value) ? value : 0;

  if (!Number.isFinite(limit) || limit <= 0) return Math.max(0, safeValue);

  return clamp(safeValue, 0, limit);
}

export function shouldSyncMedia(currentTime, position, tolerance = 0.08) {
  const current = Number(currentTime);
  const target = Number(position);
  const threshold = Math.max(0, Number(tolerance) || 0);

  return Math.abs(current - target) > threshold;
}

export function getSecondaryMediaPosition(position, duration) {
  const target = Number(position);
  const limit = Number(duration);
  if (!Number.isFinite(target)) return 0;
  if (!Number.isFinite(limit) || limit <= 0) return Math.max(0, target);
  return clamp(target, 0, limit);
}

export function createPlayerSyncCommand(action, songId, position) {
  return {
    type: "karaoke-player",
    action,
    songId,
    position: Number.isFinite(Number(position)) ? Number(position) : 0
  };
}

export function getMicrophoneLevel(signal) {
  const rmsDb = Number(signal?.rms_db ?? signal?.rms_dbfs);
  if (!Number.isFinite(rmsDb)) return 0;
  return clamp(((rmsDb + 60) / 60) * 100, 0, 100);
}
