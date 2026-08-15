import { useCallback, useRef, useState } from "react";
import { marqueeHitIds } from "./melody-editor-geometry";
import {
  adjacentNoteId,
  constrainedMoveDelta,
  deleteNotesAndTransferText,
  mergeSelectedNotes,
  resizeBounds
} from "./melody-editor-operations";
import { clamp, cloneNotes, roundTime } from "./melody-editor-state";
import useMelodyEditorHotkeys from "./useMelodyEditorHotkeys";

function getMovingSelection(selected, noteId, extend) {
  if (selected.includes(noteId)) return selected;
  return extend ? [...selected, noteId] : [noteId];
}

export default function useMelodyEditorEditing({
  auditionNote,
  duration,
  keyboardWidth,
  maxMidi,
  notes,
  pause,
  play,
  playing,
  redo,
  remember,
  replace,
  rollCanvasRef,
  rowHeight,
  saveRef,
  seek,
  selected,
  setSelected,
  syllableByIndex,
  undo,
  workspaceRef,
  zoom
}) {
  const dragRef = useRef(null);
  const selectionRef = useRef(null);
  const clipboardRef = useRef([]);
  const [selectionBox, setSelectionBox] = useState(null);
  const commit = useCallback((updater) => replace(updater, true), [replace]);
  const selectAll = useCallback(() => setSelected(notes.map((note) => note._id)), [notes]);
  const clearSelection = useCallback(() => setSelected([]), []);
  const selectAdjacentNote = useCallback(
    (direction) => {
      const id = adjacentNoteId(notes, selected, direction);
      if (!id) return;
      const note = notes.find((item) => item._id === id);
      setSelected([id]);
      seek(note.start);
      auditionNote(note.midi_note, 180);
    },
    [auditionNote, notes, seek, selected]
  );
  const deleteSelected = useCallback(() => {
    if (!selected.length) return;
    commit((current) => deleteNotesAndTransferText(current, selected, syllableByIndex));
    setSelected([]);
  }, [commit, selected, syllableByIndex]);
  const nudgeSelected = useCallback(
    (timeDelta = 0, midiDelta = 0) => {
      if (!selected.length) return;
      const chosen = notes.filter((note) => selected.includes(note._id));
      const minStart = Math.min(...chosen.map((note) => note.start));
      const maxEnd = Math.max(...chosen.map((note) => note.end));
      const safeTimeDelta = clamp(timeDelta, -minStart, duration - maxEnd);
      commit((current) =>
        current.map((note) =>
          selected.includes(note._id)
            ? {
                ...note,
                start: roundTime(note.start + safeTimeDelta),
                end: roundTime(note.end + safeTimeDelta),
                midi_note: clamp(note.midi_note + midiDelta, 0, 127)
              }
            : note
        )
      );
      auditionNote(clamp(chosen[0].midi_note + midiDelta, 0, 127), 150);
    },
    [auditionNote, commit, duration, notes, selected]
  );
  const copySelected = useCallback(() => {
    const chosen = notes.filter((note) => selected.includes(note._id));
    clipboardRef.current = cloneNotes(chosen);
  }, [notes, selected]);
  const pasteNotes = useCallback(() => {
    const copied = clipboardRef.current;
    if (!copied.length) return;
    const minStart = Math.min(...copied.map((note) => note.start));
    const span = Math.max(...copied.map((note) => note.end)) - minStart;
    const anchor = clamp(time, 0, Math.max(0, duration - span));
    const stamp = Date.now();
    const pasted = copied.map((note, index) => ({
      ...note,
      _id: `paste-${stamp}-${index}`,
      start: roundTime(anchor + note.start - minStart),
      end: roundTime(anchor + note.end - minStart)
    }));
    commit((current) => [...current, ...pasted]);
    setSelected(pasted.map((note) => note._id));
  }, [commit, duration, time]);
  const duplicateSelected = useCallback(() => {
    const chosen = notes.filter((note) => selected.includes(note._id));
    if (!chosen.length) return;
    const minStart = Math.min(...chosen.map((note) => note.start));
    const maxEnd = Math.max(...chosen.map((note) => note.end));
    const span = Math.max(0.03, maxEnd - minStart);
    const offset = clamp(span, 0, Math.max(0, duration - maxEnd));
    if (offset <= 0) return;
    const stamp = Date.now();
    const copies = chosen.map((note, index) => ({
      ...note,
      _id: `duplicate-${stamp}-${index}`,
      start: roundTime(note.start + offset),
      end: roundTime(note.end + offset)
    }));
    commit((current) => [...current, ...copies]);
    setSelected(copies.map((note) => note._id));
  }, [commit, duration, notes, selected]);
  const mergeSelected = useCallback(() => {
    const result = mergeSelectedNotes(notes, selected, syllableByIndex);
    commit(result.notes);
    setSelected([result.selectedId]);
  }, [commit, notes, selected, syllableByIndex]);
  const assignSyllable = useCallback(
    (value) => {
      const syllableIndex = value === "" ? null : Number(value);
      const syllable = syllableByIndex.get(syllableIndex);
      commit((current) =>
        current.map((note) =>
          selected.includes(note._id)
            ? {
                ...note,
                syllable_index: syllableIndex,
                word_index: syllable?.word_index ?? null,
                editor_text: syllableIndex == null ? "" : String(syllable?.text || "")
              }
            : note
        )
      );
    },
    [commit, selected, syllableByIndex]
  );
  const startDrag = useCallback(
    (event, note, mode) => {
      event.preventDefault();
      event.stopPropagation();
      const extend = event.shiftKey || event.ctrlKey || event.metaKey;
      const movingSelection = getMovingSelection(selected, note._id, extend);
      setSelected(movingSelection);
      const originals = new Map(
        notes
          .filter((item) => movingSelection.includes(item._id))
          .map((item) => [item._id, { ...item }])
      );
      auditionNote(note.midi_note, 150);
      dragRef.current = {
        id: note._id,
        ids: movingSelection,
        mode,
        x: event.clientX,
        y: event.clientY,
        originals,
        snapshot: cloneNotes(notes),
        moved: false
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [auditionNote, notes, selected]
  );
  const drag = useCallback(
    (event) => {
      const state = dragRef.current;
      if (!state) return;
      const dx = (event.clientX - state.x) / zoom;
      const rawDy = Math.round((state.y - event.clientY) / rowHeight);
      if (Math.abs(event.clientX - state.x) > 1 || Math.abs(event.clientY - state.y) > 1)
        state.moved = true;
      const dy = event.shiftKey ? 0 : rawDy;
      if (state.mode === "move") {
        const safeDx = constrainedMoveDelta(state.snapshot, state.ids, dx, duration);
        const previewMidi = clamp(state.originals.get(state.id).midi_note + dy, 0, 127);
        if (state.previewMidi !== previewMidi) {
          state.previewMidi = previewMidi;
          auditionNote(previewMidi, 95);
        }
        replace(
          (current) =>
            current.map((note) => {
              const original = state.originals.get(note._id);
              if (!original) return note;
              return {
                ...note,
                start: roundTime(original.start + safeDx),
                end: roundTime(original.end + safeDx),
                midi_note: clamp(original.midi_note + dy, 0, 127)
              };
            }),
          false
        );
        return;
      }
      const original = state.originals.get(state.id);
      const bounds = resizeBounds(state.snapshot, state.id, duration);
      let { start } = original;
      let { end } = original;
      if (state.mode === "left") {
        // The left handle can freely extend left until the song start or the previous note.
        start = clamp(original.start + dx, bounds.minStart, bounds.maxStart);
      } else {
        // The right handle stops at the next note, so notes never overlap.
        end = clamp(original.end + dx, bounds.minEnd, bounds.maxEnd);
      }
      if (!state.lastResizePreview || performance.now() - state.lastResizePreview > 90) {
        state.lastResizePreview = performance.now();
        auditionNote(original.midi_note, 85);
      }
      replace(
        (current) =>
          current.map((note) =>
            note._id === state.id ? { ...note, start: roundTime(start), end: roundTime(end) } : note
          ),
        false
      );
    },
    [auditionNote, duration, replace, rowHeight, zoom]
  );
  const endDrag = useCallback(() => {
    const state = dragRef.current;
    if (!state) return;
    dragRef.current = null;
    if (state.moved) {
      remember(state.snapshot);
      const current = notes.find((note) => note._id === state.id);
      auditionNote(current.midi_note, 170);
    }
  }, [auditionNote, notes, remember]);
  const marqueeSelection = useCallback(
    (state) => {
      const hit = marqueeHitIds({
        notes,
        x1: state.x1,
        y1: state.y1,
        x2: state.x2,
        y2: state.y2,
        keyboardWidth,
        zoom,
        rowHeight,
        maxMidi
      });
      return [...new Set([...state.base, ...hit])];
    },
    [keyboardWidth, maxMidi, notes, rowHeight, zoom]
  );
  const startMarquee = useCallback(
    (event) => {
      if (
        event.button !== 0 ||
        event.target.closest?.(
          ".melody-editor-note, .melody-editor-piano-key, .melody-editor-playhead"
        )
      )
        return;
      event.preventDefault();
      const canvas = rollCanvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const additive = event.shiftKey || event.ctrlKey || event.metaKey;
      const state = {
        pointerId: event.pointerId,
        x1: x,
        y1: y,
        x2: x,
        y2: y,
        additive,
        base: additive ? [...selected] : []
      };
      selectionRef.current = state;
      setSelectionBox({ x1: x, y1: y, x2: x, y2: y });
      if (!additive) setSelected([]);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [selected]
  );
  const updateMarquee = useCallback(
    (event) => {
      const state = selectionRef.current;
      if (!state || state.pointerId !== event.pointerId) return;
      const canvas = rollCanvasRef.current;
      const rect = canvas.getBoundingClientRect();
      state.x2 = event.clientX - rect.left;
      state.y2 = event.clientY - rect.top;
      setSelectionBox({ x1: state.x1, y1: state.y1, x2: state.x2, y2: state.y2 });

      // Highlight notes while the rectangle is moving, not only after mouse-up.
      if (Math.abs(state.x2 - state.x1) >= 2 || Math.abs(state.y2 - state.y1) >= 2) {
        setSelected(marqueeSelection(state));
      }
    },
    [marqueeSelection]
  );
  const endMarquee = useCallback(
    (event) => {
      const state = selectionRef.current;
      if (!state || (event?.pointerId != null && state.pointerId !== event.pointerId)) return;
      selectionRef.current = null;
      setSelectionBox(null);
      const dragged = Math.abs(state.x2 - state.x1) >= 3 || Math.abs(state.y2 - state.y1) >= 3;
      if (!dragged) {
        if (!state.additive) setSelected([]);
        return;
      }
      setSelected(marqueeSelection(state));
    },
    [marqueeSelection]
  );
  useMelodyEditorHotkeys({
    clearSelection,
    copySelected,
    deleteSelected,
    duplicateSelected,
    duration,
    nudgeSelected,
    pasteNotes,
    pause,
    play,
    playing,
    redo,
    saveRef,
    seek,
    selectAdjacentNote,
    selectAll,
    selectedCount: selected.length,
    undo,
    workspaceRef
  });

  return {
    assignSyllable,
    deleteSelected,
    drag,
    endDrag,
    endMarquee,
    mergeSelected,
    selectionBox,
    startDrag,
    startMarquee,
    updateMarquee
  };
}
