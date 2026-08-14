import { translateSaved } from "../../../i18n/runtime";
// Node test runner requires the explicit extension for this ESM import.
// eslint-disable-next-line import/extensions
import { normalizeNoteList } from "./note-normalization.js";

const KEY_PITCHES = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11
};
const SHARP_KEYS = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B"
];
export function noteNameToMidi(noteName) {
  if (typeof noteName !== "string") return null;
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(noteName.trim());
  if (!match) return null;
  const semitones = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11
  };
  const [, letter, accidental, octaveText] = match;
  const base = semitones[letter.toUpperCase()];
  const offset = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  const midi = (Number(octaveText) + 1) * 12 + base + offset;
  return Number.isInteger(midi) && midi >= 0 && midi <= 127 ? midi : null;
}
export function normalizeLyrics(raw) {
  if (!raw) return [];
  const source = Array.isArray(raw) ? raw : raw.lines || raw.segments || [];
  const list = Array.isArray(source) ? source : [];
  const toText = (value) =>
    typeof value === "string" || typeof value === "number"
      ? String(value).trim()
      : "";
  const readTime = (value, keys) => {
    for (const key of keys) {
      const rawValue = value[key];
      if (rawValue === null || rawValue === undefined || rawValue === "")
        continue;
      const number = Number(rawValue);
      if (Number.isFinite(number) && number >= 0) return number;
    }
    return null;
  };
  const startKeys = ["start", "start_sec", "start_time", "begin", "from"];
  const endKeys = ["end", "end_sec", "end_time", "finish", "to"];
  return list
    .filter((line) => line && typeof line === "object")
    .map((line, sourceIndex) => {
      const declaredStart = readTime(line, startKeys);
      const declaredEnd = readTime(line, endKeys);
      const words = Array.isArray(line.words)
        ? line.words
            .filter((word) => word && typeof word === "object")
            .map((word, wordIndex) => ({
              ...word,
              text: toText(word.word ?? word.text),
              start: readTime(word, startKeys),
              end: readTime(word, endKeys),
              __wordIndex: wordIndex
            }))
            // Preserve the backend/source word order. Sorting a partially timed
            // line by timestamp can move untimed words to the end and visibly
            // scramble the lyric text. Timing repair happens later without
            // changing the textual order.
            .filter((word) => word.text)
        : [];
      const timedWords = words.filter(
        (word) => Number.isFinite(word.start) || Number.isFinite(word.end)
      );
      const finiteWordStarts = timedWords
        .map((word) => word.start)
        .filter(Number.isFinite);
      const finiteWordEnds = timedWords
        .map((word) => word.end)
        .filter(Number.isFinite);
      const wordStart = finiteWordStarts.length
        ? Math.min(...finiteWordStarts)
        : null;
      const wordEnd = finiteWordEnds.length
        ? Math.max(...finiteWordEnds)
        : null;
      const startTime = declaredStart ?? wordStart ?? null;
      const endTime = declaredEnd ?? wordEnd ?? null;
      const text =
        toText(line.text ?? line.line) ||
        words
          .map((word) => word.text)
          .join(" ")
          .trim();

      // Untimed lines are unsafe for real-time karaoke. In particular, never
      // coerce a missing start to zero: that makes an arbitrary line appear at
      // the beginning of every song.
      if (!text || startTime === null) return null;
      const safeEnd =
        endTime !== null && endTime >= startTime ? endTime : startTime;
      return {
        ...line,
        start: startTime,
        end: safeEnd,
        text,
        words: words.map(({ __wordIndex: _, ...word }) => word),
        __sourceIndex: sourceIndex
      };
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        left.__sourceIndex - right.__sourceIndex
    )
    .map((line, index, lines) => {
      const { __sourceIndex: _, ...cleanLine } = line;
      // If a backend omitted/invalidated line end, use the next line boundary
      // rather than creating a zero-length line that can never become current.
      if (cleanLine.end <= cleanLine.start) {
        const nextStart = lines[index + 1]?.start;
        cleanLine.end =
          Number.isFinite(nextStart) && nextStart > cleanLine.start
            ? nextStart
            : cleanLine.start + 2;
      }
      return cleanLine;
    });
}
export const normalizeNotes = (raw) => normalizeNoteList(raw, noteNameToMidi);
export function transposeKey(key, semitones) {
  if (!key) return translateSaved("Тональность не определена");
  const match = /^([A-G](?:#|b)?)(.*)$/i.exec(key.trim());
  if (!match) return key;
  const [, rootText, suffix] = match;
  const root = rootText[0].toUpperCase() + rootText.slice(1);
  const pitch = KEY_PITCHES[root];
  if (pitch == null) return key;
  const shift = Number.isFinite(Number(semitones))
    ? Math.round(Number(semitones))
    : 0;
  const normalizedPitch = (((pitch + shift) % 12) + 12) % 12;
  return `${SHARP_KEYS[normalizedPitch]}${suffix}`;
}
export function playbackGain(value) {
  const normalized = Math.max(0, Math.min(1, Number(value) || 0));
  return normalized ** 2;
}
export function getYouTubeVideoId(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    let id = null;
    if (host === "youtu.be") {
      const [, pathnameId] = parsed.pathname.split("/");
      id = pathnameId;
    }
    if (
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtube-nocookie.com" ||
      host.endsWith(".youtube-nocookie.com")
    ) {
      id =
        parsed.searchParams.get("v") ||
        parsed.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/)?.[1];
    }
    return /^[\w-]{11}$/.test(id || "") ? id : null;
  } catch {
    return null;
  }
}
export function youTubeEmbedUrl(videoId) {
  const id = typeof videoId === "string" ? videoId.trim() : "";
  if (!/^[\w-]{11}$/.test(id)) return null;
  return `https://www.youtube.com/embed/${id}?enablejsapi=1&playsinline=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&cc_load_policy=0&rel=0&modestbranding=1&mute=1`;
}
export function createPanoramaPath(random = Math.random) {
  return {
    xPhaseA: random() * Math.PI * 2,
    xPhaseB: random() * Math.PI * 2,
    xPhaseC: random() * Math.PI * 2,
    yPhaseA: random() * Math.PI * 2,
    yPhaseB: random() * Math.PI * 2
  };
}
