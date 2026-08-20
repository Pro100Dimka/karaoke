import { clamp01 } from "../../../utils/math";

export function getLyricDisplayState(lyrics, currentTime) {
  const sourceLyrics = Array.isArray(lyrics) ? lyrics : [];

  let currentLineIndex = -1;
  for (let index = 0; index < sourceLyrics.length; index += 1) {
    const line = sourceLyrics[index];
    if (line.start > currentTime) break;
    if (currentTime < line.end) currentLineIndex = index;
  }

  const currentLine = sourceLyrics[currentLineIndex] || null;
  const upcomingLineIndex = sourceLyrics.findIndex((line) => line.start > currentTime);
  const upcomingLine = sourceLyrics[upcomingLineIndex] || null;
  const primaryLineIndex = currentLine ? currentLineIndex : upcomingLineIndex;
  const nextLine = primaryLineIndex >= 0 ? sourceLyrics[primaryLineIndex + 1] || null : null;

  return { currentLineIndex, currentLine, upcomingLine, nextLine };
}

export function getLyricFill(currentTime, start, end) {
  if (end <= start) return currentTime >= end ? 1 : 0;
  return clamp01((currentTime - start) / (end - start));
}
