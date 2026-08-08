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

  const semitones = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
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

  return list
    .filter((line) => line && typeof line === "object")
    .map((line) => {
      const fallbackStart = Number(line.start ?? line.begin ?? 0);
      const rawFallbackEnd = Number(line.end ?? fallbackStart + 2);
      if (!Number.isFinite(fallbackStart)) return null;
      const fallbackEnd = Number.isFinite(rawFallbackEnd)
        ? Math.max(fallbackStart, rawFallbackEnd)
        : fallbackStart + 2;
      const words = Array.isArray(line.words)
        ? line.words
            .filter((word) => word && typeof word === "object")
            .map((word) => ({
              text: toText(word.word ?? word.text),
              start: Number(word.start ?? fallbackStart),
              end: Number(word.end ?? fallbackEnd)
            }))
            .filter(
              (word) =>
                word.text &&
                Number.isFinite(word.start) &&
                Number.isFinite(word.end) &&
                word.end >= word.start
            )
            .sort(
              (left, right) => left.start - right.start || left.end - right.end
            )
        : [];
      const startTime = words.length ? words[0].start : fallbackStart;
      const endTime = words.length ? words.at(-1).end : fallbackEnd;
      const text =
        toText(line.text ?? line.line) ||
        words
          .map((word) => word.text)
          .join(" ")
          .trim();

      if (!text || !Number.isFinite(startTime) || !Number.isFinite(endTime)) {
        return null;
      }

      return {
        start: startTime,
        end: Math.max(startTime, endTime),
        text,
        words
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

export const normalizeNotes = (raw) => normalizeNoteList(raw, noteNameToMidi);

export function transposeKey(key, semitones) {
  if (!key) return "Тональность не определена";

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
