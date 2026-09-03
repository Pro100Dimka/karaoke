import { lyricsNoteFillPercent, lyricsSyllableFillPercent } from "../../../../../utils/lyrics-sync";

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
    const start = offset;
    let matched = 0;
    // KAR files often store a standalone dash as its own timed word (for
    // example "Ты - летящий ..."). The canonical text contains that dash,
    // but WORD intentionally counts only lexical tokens. Consume punctuation
    // words without counting them so they remain on the correct line and do
    // not shift every following line by one position.
    while (offset < words.length && matched < count) {
      matched += [...String(words[offset]?.text || "").matchAll(WORD)].length;
      offset += 1;
    }
    const line = words.slice(start, offset);
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

export function lyricSyllableFill(syllable, currentTime) {
  return `${lyricsSyllableFillPercent(syllable, currentTime)}%`;
}
