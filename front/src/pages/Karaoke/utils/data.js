import { translateSaved } from "../../../i18n/runtime";
// Node test runner requires the explicit extension for this ESM import.
// eslint-disable-next-line import/extensions
import { normalizeNoteList } from "./note-normalization.js";

const ACCIDENTAL_OFFSETS = Object.freeze({ "#": 1, b: -1 });

export function noteNameToMidi(noteName) {
  if (typeof noteName !== "string") return null;
  const match = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(noteName.trim());
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
  const offset = ACCIDENTAL_OFFSETS[accidental] ?? 0;
  const midi = (Number(octaveText) + 1) * 12 + base + offset;
  return midi >= 0 && midi <= 127 ? midi : null;
}
export function normalizeLyrics(raw) {
  if (!raw) return [];
  // Stryker disable next-line ArrayDeclaration: injected primitive is filtered.
  const source = Array.isArray(raw) ? raw : raw.lines || raw.segments || [];
  // Stryker disable next-line ArrayDeclaration: injected primitive is filtered.
  const list = Array.isArray(source) ? source : [];
  const toText = (value) =>
    ["string", "number"].includes(typeof value) ? String(value).trim() : "";
  const readTime = (value, keys) => {
    for (const key of keys) {
      const rawValue = value[key];
      if ([null, ""].includes(rawValue)) continue;
      const number = Number(rawValue);
      if (Number.isFinite(number) && number >= 0) return number;
    }
    return null;
  };
  const startKeys = ["start", "start_sec", "start_time", "begin", "from"];
  const endKeys = ["end", "end_sec", "end_time", "finish", "to"];
  return list
    .filter(Boolean)
    .map((line) => {
      const declaredStart = readTime(line, startKeys);
      const declaredEnd = readTime(line, endKeys);
      const words = Array.isArray(line.words)
        ? line.words
            .filter(Boolean)
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
      const finiteWordStarts = words.map((word) => word.start).filter(Number.isFinite);
      const wordEnds = words.map((word) => word.end);
      const wordStart = finiteWordStarts.length ? Math.min(...finiteWordStarts) : null;
      const wordEnd = wordEnds.length ? Math.max(...wordEnds) : null;
      const startTime = declaredStart ?? wordStart ?? null;
      const endTime = declaredEnd ?? wordEnd ?? null;
      const text = toText(line.text ?? line.line) || words.map((word) => word.text).join(" ");

      // Untimed lines are unsafe for real-time karaoke. In particular, never
      // coerce a missing start to zero: that makes an arbitrary line appear at
      // the beginning of every song.
      if (!text || startTime === null) return null;
      return {
        ...line,
        start: startTime,
        end: endTime ?? startTime,
        text,
        words: words.map(({ __wordIndex: _, ...word }) => word)
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .map((line, index, lines) => {
      const cleanLine = { ...line };
      // If a backend omitted/invalidated line end, use the next line boundary
      // rather than creating a zero-length line that can never become current.
      if (cleanLine.end <= cleanLine.start) {
        const nextStart = lines[index + 1]?.start;
        cleanLine.end = nextStart > cleanLine.start ? nextStart : cleanLine.start + 2;
      }
      return cleanLine;
    });
}
export function normalizeNotes(raw) {
  return normalizeNoteList(raw, noteNameToMidi);
}
export function transposeKey(key, semitones) {
  if (!key) return translateSaved("Тональность не определена");
  const match = /^([A-G](?:#|b)?)(.*)/i.exec(key.trim());
  if (!match) return key;
  const [, rootText, suffix] = match;
  const root = rootText[0].toUpperCase() + rootText.slice(1);
  const pitch = {
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
  }[root];
  if (pitch == null) return key;
  const shift = Number.isFinite(Number(semitones)) ? Math.round(Number(semitones)) : 0;
  const normalizedPitch = (((pitch + shift) % 12) + 12) % 12;
  return `${
    ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][normalizedPitch]
  }${suffix}`;
}
export function playbackGain(value) {
  const normalized = Math.max(0, Math.min(1, Number(value) || 0));
  return normalized ** 2;
}
export function getYouTubeVideoId(url) {
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
        // Stryker disable next-line OptionalChaining: final validation rejects no match.
        parsed.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/)?.[1];
    }
    return /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
export function youTubeEmbedUrl(videoId) {
  if (typeof videoId !== "string") return null;
  const id = videoId.trim();
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
