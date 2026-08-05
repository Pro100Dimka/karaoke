export function getTimelineProgress(value, duration) {
  const safeDuration = Number(duration);
  const safeValue = Number(value);

  if (!Number.isFinite(safeDuration) || safeDuration <= 0) return 0;
  if (!Number.isFinite(safeValue)) return 0;

  return Math.max(0, Math.min(1, safeValue / safeDuration));
}

export function getSeekTime(clientX, left, width, duration) {
  const safeClientX = Number(clientX);
  const safeLeft = Number(left);
  const safeWidth = Number(width);
  const safeDuration = Number(duration);
  if (!Number.isFinite(safeClientX) || !Number.isFinite(safeLeft)) return null;
  if (!Number.isFinite(safeWidth) || safeWidth <= 0) return null;
  if (!Number.isFinite(safeDuration) || safeDuration <= 0) return null;

  const ratio = Math.max(0, Math.min(1, (safeClientX - safeLeft) / safeWidth));

  return ratio * safeDuration;
}
