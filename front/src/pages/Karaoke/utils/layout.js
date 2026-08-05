function toNonNegativeFinite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function getKaraokeStageLayout({
  mainWidth,
  mainHeight,
  stageWidth,
  stageHeight,
  currentNavExtra = 0
}) {
  const safeMainWidth = toNonNegativeFinite(mainWidth);
  const safeMainHeight = toNonNegativeFinite(mainHeight);
  const safeStageWidth = toNonNegativeFinite(stageWidth);
  const safeStageHeight = toNonNegativeFinite(stageHeight);
  const safeCurrentExtra = toNonNegativeFinite(currentNavExtra);
  const fullAvailableHeight = safeMainHeight + safeCurrentExtra;
  const targetStageHeight = (safeMainWidth * 9) / 16;
  const navExtra = Math.max(0, fullAvailableHeight - targetStageHeight);
  const videoWidth = Math.max(safeStageWidth, (safeStageHeight * 16) / 9);
  const videoHeight = Math.max(safeStageHeight, (safeStageWidth * 9) / 16);

  return {
    navExtra,
    videoWidth: Math.ceil(videoWidth) + 2,
    videoHeight: Math.ceil(videoHeight) + 2
  };
}
