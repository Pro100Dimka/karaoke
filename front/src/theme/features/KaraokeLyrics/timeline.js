import { lyricsNoteFillPercent } from "../../../utils/lyrics-sync";

const WORD = /[\p{L}\p{N}_]+(?:[’'-][\p{L}\p{N}_]+)*/gu;
const LINE_HOLD_SECONDS = 1.2;

export function buildLyricLines({ text, words } = {}) {
  if (!Array.isArray(words)) return [];
  const timedFallback = () => {
    const lines = [];
    let line = [];
    words.forEach((word, index) => {
      line.push(word);
      const next = words[index + 1];
      const gap = next ? Number(next.start) - Number(word.end) : Number.POSITIVE_INFINITY;
      if (line.length >= 8 || gap >= 1 || !next) {
        lines.push(line);
        line = [];
      }
    });
    return lines;
  };
  if (typeof text !== "string") return timedFallback();
  let offset = 0;
  const lines = text.split(/\r?\n/).flatMap((source) => {
    const count = [...source.matchAll(WORD)].length;
    const line = words.slice(offset, offset + count);
    offset += line.length;
    return line.length ? [line] : [];
  });
  return offset === words.length ? lines : timedFallback();
}

export function lyricLineIndex(lines, currentTime) {
  const started = lines.findLastIndex((line) => Number(line[0]?.start) <= currentTime);
  let first = Math.max(0, started);
  if (first && currentTime < Number(lines[first - 1][0]?.start) + LINE_HOLD_SECONDS) first -= 1;
  return first;
}

export function lyricWordFill(word, currentTime) {
  return `${lyricsNoteFillPercent(word, currentTime)}%`;
}
