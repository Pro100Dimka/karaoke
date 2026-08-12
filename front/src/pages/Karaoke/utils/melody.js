// Node test runner requires the explicit extension for this ESM import.
// eslint-disable-next-line import/extensions
import { normalizeNoteList } from "./note-normalization.js";

const DEFAULT_MIDI_CENTER = 60;

export function getMelodyRange({
  notes,
  keyShift = 0,
  noteRangeMin,
  noteRangeMax,
  fallbackMidi = DEFAULT_MIDI_CENTER
}) {
  const safeNotes = Array.isArray(notes)
    ? notes.filter((note) => note && typeof note === "object")
    : [];
  const shift = Number.isFinite(Number(keyShift)) ? Number(keyShift) : 0;
  const savedMin = Number(noteRangeMin);
  const savedMax = Number(noteRangeMax);
  const hasSavedRange =
    noteRangeMin != null &&
    noteRangeMax != null &&
    Number.isFinite(savedMin) &&
    Number.isFinite(savedMax) &&
    savedMax >= savedMin;
  const noteMidiValues = safeNotes
    .filter((note) => note && typeof note === "object")
    .map((note) => Number(note.midi) + shift)
    .filter(Number.isFinite);
  const finiteFallback = Number.isFinite(Number(fallbackMidi))
    ? Number(fallbackMidi)
    : DEFAULT_MIDI_CENTER;
  // The database range may come from an older processing run. Never let stale
  // metadata crop notes that are actually present in the current /result.
  const actualMin = noteMidiValues.length ? Math.min(...noteMidiValues) : null;
  const actualMax = noteMidiValues.length ? Math.max(...noteMidiValues) : null;
  const sourceMin = hasSavedRange
    ? actualMin == null
      ? savedMin + shift
      : Math.min(savedMin + shift, actualMin)
    : (actualMin ?? finiteFallback);
  const sourceMax = hasSavedRange
    ? actualMax == null
      ? savedMax + shift
      : Math.max(savedMax + shift, actualMax)
    : (actualMax ?? finiteFallback);
  const minMidi = Math.floor(sourceMin) - 2;
  const maxMidi = Math.ceil(sourceMax) + 2;

  return {
    minMidi,
    maxMidi,
    pitchRange: Math.max(1, maxMidi - minMidi + 1)
  };
}

export function getVisibleNotes(notes, viewStart, viewEnd) {
  const start = Number(viewStart);
  const end = Number(viewEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];

  return (Array.isArray(notes) ? notes : []).filter((note) => {
    const noteStart = Number(note?.start);
    const noteEnd = Number(note?.end);
    return (
      Number.isFinite(noteStart) &&
      Number.isFinite(noteEnd) &&
      noteEnd >= noteStart &&
      noteEnd >= start &&
      noteStart <= end
    );
  });
}

export function getMelodyCue({ notes, currentTime, keyShift = 0 }) {
  const time = Number(currentTime);
  const shift = Number(keyShift);
  const safeTime = Number.isFinite(time) ? time : 0;
  const safeShift = Number.isFinite(shift) ? shift : 0;
  const safeNotes = normalizeNoteList(notes);
  const activeNote = safeNotes.find(
    (note) => safeTime >= note.start && safeTime < note.end
  );
  const cueNote =
    activeNote ||
    safeNotes.find(
      (note) => note.start >= safeTime - 0.08 && note.start <= safeTime + 1.4
    ) ||
    safeNotes.find((note) => note.end >= safeTime) ||
    null;

  return {
    activeNote: activeNote || null,
    activeMidi: activeNote ? activeNote.midi + safeShift : null,
    cueNote,
    targetMidi: cueNote ? cueNote.midi + safeShift : null
  };
}
