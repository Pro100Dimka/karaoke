import { lyricsNoteFillPercent, lyricsSyllableFillPercent } from "../../../../utils/lyrics-sync";

const WORD = /[\p{L}\p{N}_]+(?:[’'-][\p{L}\p{N}_]+)*/gu;
const HOLD = 1.2;
const countWords = (value) => [...String(value ?? "").matchAll(WORD)].length;

const fallbackLines = (words) => {
  const lines = [];
  let start = 0;

  for (let i = 0; i < words.length; i++) {
    const next = words[i + 1];
    const gap = next ? Number(next.start) - Number(words[i].end) : Infinity;
    if (i - start >= 7 || gap >= 1 || !next) {
      lines.push(words.slice(start, i + 1));
      start = i + 1;
    }
  }

  return lines;
};

export function buildLyricLines({ text, words } = {}) {
  const list = Array.isArray(words) ? words.filter(Boolean) : [];
  if (!list.length) return [];
  if (typeof text !== "string") return fallbackLines(list);

  const lines = [];
  let offset = 0;

  for (const source of text.split(/\r?\n/)) {
    const start = offset;
    let remaining = countWords(source);

    while (offset < list.length && remaining > 0) {
      remaining -= countWords(list[offset++].text);
    }

    if (offset > start) lines.push(list.slice(start, offset));
  }

  return offset === list.length ? lines : fallbackLines(list);
}

export function lyricLineIndex(lines = [], time = 0) {
  const index = Math.max(
    0,
    lines.findLastIndex((line) => Number(line?.[0]?.start) <= Number(time))
  );
  return index && time < Number(lines[index - 1]?.[0]?.start) + HOLD ? index - 1 : index;
}

const fill = (fn, value, time) => `${fn(value, time)}%`;
export const lyricWordFill = (word, time) => fill(lyricsNoteFillPercent, word, time);
export const lyricSyllableFill = (syllable, time) => fill(lyricsSyllableFillPercent, syllable, time);
