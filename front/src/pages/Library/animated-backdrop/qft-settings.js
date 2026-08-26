// Compatibility exports retained for the repository's existing focused tests.
// Runtime settings are the unmodified STATE object inside qftvisualizer.html.
export const QFT_DEFAULT_SETTINGS = Object.freeze({ adaptiveQuality: true });

export function nextAdaptivePixelRatio(
  currentPixelRatio,
  fps,
  { targetFPS, pixelRatioMax, minPixelRatio = 0.75 }
) {
  if (fps < targetFPS - 8) return Math.max(minPixelRatio, currentPixelRatio - 0.1);
  if (fps > targetFPS + 6) return Math.min(pixelRatioMax, currentPixelRatio + 0.05);
  return currentPixelRatio;
}
