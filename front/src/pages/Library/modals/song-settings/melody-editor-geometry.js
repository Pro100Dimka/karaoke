export const clampEditor = (value, min, max) =>
  Math.max(min, Math.min(max, value));

export function anchoredHorizontalScroll({
  time,
  oldZoom,
  newZoom,
  keyboardWidth,
  scrollLeft,
  clientWidth,
  scrollWidth
}) {
  const oldX = keyboardWidth + Math.max(0, time) * oldZoom;
  const screenX = oldX - scrollLeft;
  const newX = keyboardWidth + Math.max(0, time) * newZoom;
  return clampEditor(newX - screenX, 0, Math.max(0, scrollWidth - clientWidth));
}

export function anchoredVerticalScroll({
  scrollTop,
  clientHeight,
  oldRowHeight,
  newRowHeight,
  rowCount
}) {
  const centerRow = (scrollTop + clientHeight / 2) / Math.max(1, oldRowHeight);
  const nextHeight = Math.max(1, rowCount) * newRowHeight;
  return clampEditor(
    centerRow * newRowHeight - clientHeight / 2,
    0,
    Math.max(0, nextHeight - clientHeight)
  );
}

export function autoFollowScrollLeft({
  playheadX,
  scrollLeft,
  clientWidth,
  keyboardWidth,
  scrollWidth
}) {
  const editableWidth = Math.max(1, clientWidth - keyboardWidth);
  const triggerX = keyboardWidth + editableWidth * 0.5;
  return Math.max(
    scrollLeft,
    clampEditor(playheadX - triggerX, 0, Math.max(0, scrollWidth - clientWidth))
  );
}

export function anchoredVerticalScrollToNote({
  noteMidi,
  maxMidi,
  oldRowHeight,
  newRowHeight,
  scrollTop,
  clientHeight,
  rowCount
}) {
  const oldY = (maxMidi - noteMidi + 0.5) * oldRowHeight;
  const screenY = oldY - scrollTop;
  const newY = (maxMidi - noteMidi + 0.5) * newRowHeight;
  const nextHeight = Math.max(1, rowCount) * newRowHeight;
  return clampEditor(newY - screenY, 0, Math.max(0, nextHeight - clientHeight));
}

export function marqueeHitIds({
  notes,
  x1,
  y1,
  x2,
  y2,
  keyboardWidth,
  zoom,
  rowHeight,
  maxMidi
}) {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  return (notes || [])
    .filter((note) => {
      const noteLeft = keyboardWidth + Number(note.start || 0) * zoom;
      const noteRight = keyboardWidth + Number(note.end || 0) * zoom;
      const noteTop = (maxMidi - Number(note.midi_note || 0)) * rowHeight + 1;
      const noteBottom = noteTop + Math.max(8, rowHeight - 2);
      return (
        noteRight >= left &&
        noteLeft <= right &&
        noteBottom >= top &&
        noteTop <= bottom
      );
    })
    .map((note) => note._id);
}
