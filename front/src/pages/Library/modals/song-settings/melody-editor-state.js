import { useCallback, useRef, useState } from "react";
import { readJsonStorage } from "../../../../utils/storage";

export const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
export const EDITOR_STORAGE_KEY = "karaoke-melody-editor";
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const roundTime = (value) => Math.round(value * 1000) / 1000;

export const noteName = (midi) => {
  const names = [
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
  const value = Number(midi);
  return `${names[((value % 12) + 12) % 12]}${Math.floor(value / 12) - 1}`;
};

export const cloneNotes = (notes) => notes.map((note) => ({ ...note }));
export const editorPreferences = () => readJsonStorage(EDITOR_STORAGE_KEY);
export const normalizeEditorNotes = (notes = []) =>
  notes
    .map((note, index) => ({
      ...note,
      _id: note._id || `note-${index}-${note.start}-${note.end}`,
      start: Number(note.start) || 0,
      end: Number(note.end) || 0,
      midi_note: Number(note.midi_note ?? note.midi ?? 60),
      velocity: Number(note.velocity) || 96,
      word_index: note.word_index ?? null,
      syllable_index: note.syllable_index ?? null
    }))
    .filter((note) => note.end > note.start)
    .sort((a, b) => a.start - b.start || a.midi_note - b.midi_note);

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
