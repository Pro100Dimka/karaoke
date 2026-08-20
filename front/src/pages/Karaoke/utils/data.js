import { translateSaved } from "../../../i18n/runtime";
import { clamp01 } from "../../../utils/math";
// Node test runner requires the explicit extension for this ESM import.
// eslint-disable-next-line import/extensions
import { normalizeNoteList } from "./note-normalization";

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
export function lyricsSyncLines(raw) {
  if (!raw || !Array.isArray(raw.words)) return [];
  const sourceLines = typeof raw.text === "string" ? raw.text.split(/\r?\n/) : [];
  const tokenPattern = /[\p{L}\p{N}_]+(?:[’'-][\p{L}\p{N}_]+)*/gu;
  const counts = sourceLines.map((text) => [...text.matchAll(tokenPattern)].length);
  if (counts.reduce((total, count) => total + count, 0) !== raw.words.length) return [];

  let cursor = 0;
  return counts
    .map((count, lineIndex) => {
      const lineWords = raw.words.slice(cursor, cursor + count);
      cursor += count;
      if (!lineWords.length) return null;
      return {
        index: lineIndex,
        text: sourceLines[lineIndex],
        start: lineWords[0].start,
        end: lineWords.at(-1).end,
        words: lineWords
      };
    })
    .filter(Boolean);
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
  const normalized = clamp01(Number(value) || 0);
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
