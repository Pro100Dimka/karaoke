import { clamp01 } from "../../../utils/math";

export function getTimelineProgress(value, duration) {
  const safeDuration = Number(duration);
  const safeValue = Number(value);

  if (!Number.isFinite(safeDuration) || safeDuration <= 0 || !Number.isFinite(safeValue)) {
    return 0;
  }

  return clamp01(safeValue / safeDuration);
}

export function getSeekTime(clientX, left, width, duration) {
  const safeClientX = Number(clientX);
  const safeLeft = Number(left);
  const safeWidth = Number(width);
  const safeDuration = Number(duration);
  if (
    !Number.isFinite(safeClientX) ||
    !Number.isFinite(safeLeft) ||
    !Number.isFinite(safeWidth) ||
    safeWidth <= 0 ||
    !Number.isFinite(safeDuration) ||
    safeDuration <= 0
  ) {
    return null;
  }

  const ratio = clamp01((safeClientX - safeLeft) / safeWidth);

  return ratio * safeDuration;
}
