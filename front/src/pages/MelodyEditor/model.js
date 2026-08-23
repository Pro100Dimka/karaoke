import { clamp } from "../../utils/math";

const byStart = (left, right) => left.start - right.start || left.note - right.note;
export const roundTime = (value) => Math.round(value * 1000) / 1000;
export const cloneNotes = (notes) => notes.map((note) => ({ ...note }));

export function normalizeNotes(notes = []) {
  const ordered = notes
    .map((source, index) => {
      const wordStart = Number(source.word_start);
      const wordEnd = Number(source.word_end);
      return {
        ...source,
        _id: source._id || `note-${index}-${source.start}-${source.end}`,
        note: Number(source.note),
        start: Math.max(wordStart, Number(source.start)),
        end: Math.min(wordEnd, Number(source.end)),
        word_index: Number(source.word_index),
        word_start: wordStart,
        word_end: wordEnd
      };
    })
    .filter(
      (note) =>
        Number.isInteger(note.note) &&
        note.note >= 0 &&
        note.note <= 127 &&
        Number.isInteger(note.word_index) &&
        note.end > note.start
    )
    .sort(byStart);
  // Notes share one timeline regardless of which word they were originally
  // attached to (a merge can span two words), so overlap is resolved
  // globally here rather than per word.
  let previousEnd = -Infinity;
  return ordered.filter((note) => {
    if (note.start < previousEnd) return false;
    previousEnd = note.end;
    return true;
  });
}

const selectedNotes = (notes, ids) => {
  const selected = new Set(ids);
  return notes.filter(({ _id }) => selected.has(_id)).sort(byStart);
};

// Two or more selected notes can merge as long as nothing unselected sits
// between them on the timeline -- they no longer need to share a word, since
// a sustained note that was split at a word boundary is exactly the case
// this exists to fix.
const isContiguousSelection = (notes, chosen) => {
  if (chosen.length < 2) return false;
  const ordered = [...notes].sort(byStart);
  const chosenIds = new Set(chosen.map(({ _id }) => _id));
  const positions = ordered.map(({ _id }) => _id).filter((id) => chosenIds.has(id));
  const first = ordered.findIndex(({ _id }) => _id === positions[0]);
  return ordered.slice(first, first + positions.length).every(({ _id }) => chosenIds.has(_id));
};

export function mergeSelectedNotes(notes, ids) {
  const chosen = selectedNotes(notes, ids);
  if (!isContiguousSelection(notes, chosen)) return { notes, selectedId: chosen[0]?._id || null };
  const selected = new Set(ids);
  const merged = {
    ...chosen[0],
    start: Math.min(...chosen.map(({ start }) => start)),
    end: Math.max(...chosen.map(({ end }) => end)),
    note: Math.round(chosen.reduce((sum, { note }) => sum + note, 0) / chosen.length),
    word_start: Math.min(...chosen.map(({ word_start }) => word_start)),
    word_end: Math.max(...chosen.map(({ word_end }) => word_end))
  };
  return {
    notes: normalizeNotes([...notes.filter(({ _id }) => !selected.has(_id)), merged]),
    selectedId: merged._id
  };
}

export const canMergeSelectedNotes = (notes, ids) =>
  isContiguousSelection(notes, selectedNotes(notes, ids));

export const deleteNotes = (notes, ids) => {
  const selected = new Set(ids);
  return notes.filter(({ _id }) => !selected.has(_id));
};

export function adjacentNoteId(notes, ids, direction) {
  const ordered = [...notes].sort(byStart);
  if (!ordered.length) return null;
  const selected = new Set(ids);
  const anchor =
    direction > 0
      ? ordered.findIndex(({ _id }) => selected.has(_id))
      : ordered.findLastIndex(({ _id }) => selected.has(_id));
  if (anchor < 0) return direction > 0 ? ordered[0]._id : ordered.at(-1)._id;
  return ordered[clamp(anchor + Math.sign(direction), 0, ordered.length - 1)]._id;
}

export function constrainedMoveDelta(notes, ids, requested) {
  const moving = new Set(ids);
  const chosen = notes.filter(({ _id }) => moving.has(_id));
  if (!chosen.length) return 0;
  let minimum = Math.max(...chosen.map(({ word_start, start }) => word_start - start));
  let maximum = Math.min(...chosen.map(({ word_end, end }) => word_end - end));
  chosen.forEach((current) =>
    notes.forEach((neighbour) => {
      if (moving.has(neighbour._id)) return;
      if (neighbour.end <= current.start)
        minimum = Math.max(minimum, neighbour.end - current.start);
      if (neighbour.start >= current.end)
        maximum = Math.min(maximum, neighbour.start - current.end);
    })
  );
  return clamp(requested, minimum, maximum);
}

export function resizeBounds(notes, id, minimumDuration = 0.03) {
  const current = notes.find(({ _id }) => _id === id);
  if (!current) return null;
  let previousEnd = current.word_start;
  let nextStart = current.word_end;
  notes.forEach((note) => {
    if (note._id === id) return;
    if (note.end <= current.start) previousEnd = Math.max(previousEnd, note.end);
    if (note.start >= current.end) nextStart = Math.min(nextStart, note.start);
  });
  return {
    minStart: previousEnd,
    maxStart: current.end - minimumDuration,
    minEnd: current.start + minimumDuration,
    maxEnd: nextStart
  };
}

export const canonicalLyricProjection = (words = []) =>
  words.map((word, index) => ({
    index,
    text: String(word.text || ""),
    start: Number(word.start),
    end: Number(word.end)
  }));

// Moves a selected run of word texts [start, end] one slot forward or
// backward. Either way, the run and everything after it (to the end of the
// song) shifts by one slot in the same direction, so a misalignment that
// starts at the selection and repeats through the rest of the song only
// needs one shift instead of one per word. Timing slots (start/end, note
// assignments) are never touched -- only which text sits in which slot
// changes. Moving forward leaves the selection's old starting slot blank
// (nothing to its left moves in to fill it) and drops the very last word's
// text off the end of the song. Moving backward instead overwrites the one
// word immediately before the selection -- everything from the selection
// onward, including it, shifts left by one to follow -- leaving a blank
// only in the very last slot of the song. Undo with Ctrl+Z if a shift went
// further than intended.
export function shiftWordTexts(texts, range, direction) {
  const [start, end] = range;
  if (direction > 0 && end >= texts.length - 1) return texts;
  if (direction < 0 && start <= 0) return texts;
  const next = [...texts];
  if (direction > 0) {
    for (let index = texts.length - 1; index > start; index -= 1) next[index] = next[index - 1];
    next[start] = "";
  } else {
    for (let index = start - 1; index < texts.length - 1; index += 1) next[index] = next[index + 1];
    next[texts.length - 1] = "";
  }
  return next;
}

export function marqueeHitIds({ notes, x1, y1, x2, y2, keyboardWidth, zoom, rowHeight, maxMidi }) {
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  return notes
    .filter((note) => {
      const x = keyboardWidth + note.start * zoom;
      const y = (maxMidi - note.note) * rowHeight;
      return (
        x + (note.end - note.start) * zoom >= left &&
        x <= right &&
        y + rowHeight >= top &&
        y <= bottom
      );
    })
    .map(({ _id }) => _id);
}

export const initialDocument = { notes: [], wordTexts: [], past: [], future: [] };

const snapshot = (notes, wordTexts) => ({ notes: cloneNotes(notes), wordTexts: [...wordTexts] });

export function documentReducer(state, action) {
  if (action.type === "load")
    return {
      notes: normalizeNotes(action.notes),
      wordTexts: action.wordTexts || [],
      past: [],
      future: []
    };
  if (action.type === "edit")
    return {
      ...state,
      notes: normalizeNotes(action.notes),
      past: action.record
        ? [...state.past.slice(-79), snapshot(state.notes, state.wordTexts)]
        : state.past,
      future: action.record ? [] : state.future
    };
  if (action.type === "shiftWords")
    return {
      ...state,
      wordTexts: action.wordTexts,
      past: [...state.past.slice(-79), snapshot(state.notes, state.wordTexts)],
      future: []
    };
  if (action.type === "remember")
    return {
      ...state,
      past: [...state.past.slice(-79), snapshot(action.notes, state.wordTexts)],
      future: []
    };
  if (action.type === "undo" && state.past.length)
    return {
      ...state,
      notes: state.past.at(-1).notes,
      wordTexts: state.past.at(-1).wordTexts,
      past: state.past.slice(0, -1),
      future: [snapshot(state.notes, state.wordTexts), ...state.future]
    };
  if (action.type === "redo" && state.future.length)
    return {
      ...state,
      notes: state.future[0].notes,
      wordTexts: state.future[0].wordTexts,
      past: [...state.past, snapshot(state.notes, state.wordTexts)],
      future: state.future.slice(1)
    };
  return state;
}

// Splits each note against every word it overlaps in time and clips it to
// that word's own bounds, rather than trusting the note's own (possibly
// stale, e.g. after a cross-word merge) word_index. This is what lets a
// merged note that spans two words save correctly without changing the
// backend's per-word note contract at all -- each word still only ever
// receives notes clipped to its own bounds, exactly as it always did.
export function serializeNotes(notes, words = []) {
  const result = [];
  notes.forEach((note) => {
    words.forEach((word, index) => {
      const start = roundTime(Math.max(note.start, Number(word.start)));
      const end = roundTime(Math.min(note.end, Number(word.end)));
      if (end <= start) return;
      result.push({ note: note.note, start, end, word_index: index });
    });
  });
  return result;
}
