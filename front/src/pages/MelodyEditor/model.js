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
    .sort((a, b) => a.word_index - b.word_index || byStart(a, b));
  const endByWord = new Map();
  return ordered
    .filter((note) => {
      const previous = endByWord.get(note.word_index) ?? note.word_start;
      if (note.start < previous) return false;
      endByWord.set(note.word_index, note.end);
      return true;
    })
    .sort(byStart);
}

const selectedNotes = (notes, ids) => {
  const selected = new Set(ids);
  return notes.filter(({ _id }) => selected.has(_id)).sort(byStart);
};

export function mergeSelectedNotes(notes, ids) {
  const chosen = selectedNotes(notes, ids);
  if (chosen.length < 2 || chosen.some((note) => note.word_index !== chosen[0].word_index))
    return { notes, selectedId: chosen[0]?._id || null };
  const selected = new Set(ids);
  const merged = {
    ...chosen[0],
    start: Math.min(...chosen.map(({ start }) => start)),
    end: Math.max(...chosen.map(({ end }) => end)),
    note: Math.round(chosen.reduce((sum, { note }) => sum + note, 0) / chosen.length)
  };
  return {
    notes: normalizeNotes([...notes.filter(({ _id }) => !selected.has(_id)), merged]),
    selectedId: merged._id
  };
}

export const canMergeSelectedNotes = (notes, ids) => {
  const chosen = selectedNotes(notes, ids);
  return chosen.length > 1 && chosen.every(({ word_index }) => word_index === chosen[0].word_index);
};

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
      if (moving.has(neighbour._id) || neighbour.word_index !== current.word_index) return;
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
    if (note._id === id || note.word_index !== current.word_index) return;
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

export const initialDocument = { notes: [], past: [], future: [] };

export function documentReducer(state, action) {
  if (action.type === "load") return { notes: normalizeNotes(action.notes), past: [], future: [] };
  if (action.type === "edit")
    return {
      notes: normalizeNotes(action.notes),
      past: action.record ? [...state.past.slice(-79), cloneNotes(state.notes)] : state.past,
      future: action.record ? [] : state.future
    };
  if (action.type === "remember")
    return { ...state, past: [...state.past.slice(-79), cloneNotes(action.notes)], future: [] };
  if (action.type === "undo" && state.past.length)
    return {
      notes: state.past.at(-1),
      past: state.past.slice(0, -1),
      future: [cloneNotes(state.notes), ...state.future]
    };
  if (action.type === "redo" && state.future.length)
    return {
      notes: state.future[0],
      past: [...state.past, cloneNotes(state.notes)],
      future: state.future.slice(1)
    };
  return state;
}

export const serializeNotes = (notes) =>
  notes.map(({ note, start, end, word_index }) => ({ note, start, end, word_index }));
