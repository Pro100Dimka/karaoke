import { useCallback, useRef, useState } from "react";
import { readJsonStorage } from "../../../../utils/storage";

export { clamp } from "../../../../utils/math";
export const BLACK_KEYS = [1, 3, 6, 8, 10];
export const EDITOR_STORAGE_KEY = "karaoke-melody-editor";
export const roundTime = (value) => Math.round(value * 1000) / 1000;

export const noteName = (midi) => {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const value = Number(midi);
  return `${names[((value % 12) + 12) % 12]}${Math.floor(value / 12) - 1}`;
};

export const cloneNotes = (notes) => notes.map((note) => ({ ...note }));
export const editorPreferences = () => readJsonStorage(EDITOR_STORAGE_KEY);
export const normalizeEditorNotes = (notes = []) => {
  const normalized = notes
    .map((note, index) => ({
      ...note,
      _id: note._id || `note-${index}-${note.start}-${note.end}`,
      start: Math.max(Number(note.word_start), Number(note.start)),
      end: Math.min(Number(note.word_end), Number(note.end)),
      note: Number(note.note),
      word_index: Number(note.word_index),
      word_start: Number(note.word_start),
      word_end: Number(note.word_end)
    }))
    .filter(
      (note) =>
        Number.isInteger(note.note) &&
        note.note >= 0 &&
        note.note <= 127 &&
        Number.isInteger(note.word_index) &&
        note.end > note.start
    )
    .sort((a, b) => a.word_index - b.word_index || a.start - b.start || a.note - b.note);
  const result = [];
  const wordEnds = new Map();
  for (const note of normalized) {
    const previousEnd = wordEnds.get(note.word_index) ?? note.word_start;
    if (note.start < previousEnd) continue;
    result.push(note);
    wordEnds.set(note.word_index, note.end);
  }
  return result.sort((a, b) => a.start - b.start || a.note - b.note);
};

export function useEditorHistory(initial = []) {
  const [notes, setNotesState] = useState(initial);
  const undoRef = useRef([]);
  const redoRef = useRef([]);

  const replace = useCallback((next, record = true) => {
    setNotesState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      if (record) {
        undoRef.current.push(cloneNotes(current));
        if (undoRef.current.length > 80) undoRef.current.shift();
        redoRef.current = [];
      }
      return normalizeEditorNotes(value);
    });
  }, []);

  const reset = useCallback((value) => {
    undoRef.current = [];
    redoRef.current = [];
    setNotesState(normalizeEditorNotes(value));
  }, []);

  const remember = useCallback((snapshot) => {
    undoRef.current.push(cloneNotes(snapshot));
    if (undoRef.current.length > 80) undoRef.current.shift();
    redoRef.current = [];
  }, []);

  const undo = useCallback(() => {
    setNotesState((current) => {
      const previous = undoRef.current.pop();
      if (!previous) return current;
      redoRef.current.push(cloneNotes(current));
      return previous;
    });
  }, []);

  const redo = useCallback(() => {
    setNotesState((current) => {
      const next = redoRef.current.pop();
      if (!next) return current;
      undoRef.current.push(cloneNotes(current));
      return next;
    });
  }, []);

  return { notes, replace, reset, remember, undo, redo };
}
