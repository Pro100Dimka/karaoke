const TILT_DEGREES = 7;

export function getSongCardTilt(clientX, clientY, rect) {
  const width = Number(rect?.width);
  const height = Number(rect?.height);
  const left = Number(rect?.left);
  const top = Number(rect?.top);
  if (clientX == null || clientY == null) return null;

  const pointerX = Number(clientX);
  const pointerY = Number(clientY);

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(pointerX) ||
    !Number.isFinite(pointerY)
  ) {
    return null;
  }

  const normalizedX = (pointerX - left) / width - 0.5;
  const normalizedY = (pointerY - top) / height - 0.5;

  return {
    tiltX: `${-normalizedY * TILT_DEGREES}deg`,
    tiltY: `${normalizedX * TILT_DEGREES}deg`,
    glowX: `${(normalizedX + 0.5) * 100}%`,
    glowY: `${(normalizedY + 0.5) * 100}%`
  };
}
