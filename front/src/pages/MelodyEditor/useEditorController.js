import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { clamp } from "../../utils/math";
import { readJsonStorage } from "../../utils/storage";
import { persistUiPreferences } from "../../utils/ui-preferences";
import {
  canMergeSelectedNotes,
  cloneNotes,
  constrainedMoveDelta,
  deleteNotes,
  adjacentNoteId,
  marqueeHitIds,
  mergeSelectedNotes,
  resizeBounds,
  roundTime,
  shiftWordTexts,
  wordResizeBounds
} from "./model";

const STORAGE_KEY = "karaoke-melody-editor";
const preference = (value, fallback, minimum, maximum) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : fallback;
};

export default function useEditorController({ document, dispatch, payload, save, transportRef }) {
  const saved = useMemo(() => readJsonStorage(STORAGE_KEY), []);
  const [selected, setSelected] = useState([]);
  const [selectedWords, setSelectedWords] = useState([]);
  const wordSelectAnchor = useRef(null);
  const [zoom, setZoom] = useState(() => preference(saved.zoom, 48, 36, 600));
  const [rowHeight, setRowHeight] = useState(() => preference(saved.verticalZoom, 16, 10, 36));
  const [autoScroll, setAutoScroll] = useState(() => saved.autoScroll ?? true);
  const [playbackRate, setPlaybackRate] = useState(() => Number(saved.playbackRate) || 1);
  const [volumes, setVolumes] = useState(() => ({
    vocals: Number(saved.volumes?.vocals ?? 0.7),
    melody: Number(saved.volumes?.melody ?? 0.9),
    instrumental: Number(saved.volumes?.instrumental ?? 0.45)
  }));
  const [selectionBox, setSelectionBox] = useState(null);
  const dragRef = useRef(null);
  const wordDragRef = useRef(null);
  const marqueeRef = useRef(null);
  const clipboardRef = useRef([]);
  const shellRef = useRef(null);
  const surfaceRef = useRef(null);
  const playheadRef = useRef(null);
  const { notes, wordBounds, wordTexts } = document;
  const lyricsSync = payload?.lyrics_sync || {};
  const duration = Number(lyricsSync.duration) || Math.max(1, ...notes.map(({ end }) => end));
  const midi = notes.map(({ note }) => note);
  const low = Math.min(...midi, 60);
  const high = Math.max(...midi, 72);
  const span = Math.max(60, high - low + 24);
  const center = (low + high) / 2;
  let minMidi = Math.max(0, Math.floor(center - span / 2));
  const maxMidi = Math.min(127, Math.ceil((minMidi + span) / 12) * 12);
  minMidi = Math.max(0, maxMidi - span);
  const keyboardWidth = rowHeight * 4.5;
  const laneHeight = (maxMidi - minMidi + 1) * rowHeight;
  const laneWidth = keyboardWidth + Math.max(duration, 16) * zoom;
  const words = useMemo(
    () =>
      wordBounds.map((bound, index) => ({
        index,
        text: wordTexts[index] ?? "",
        start: bound.start,
        end: bound.end
      })),
    [wordBounds, wordTexts]
  );

  useEffect(() => {
    persistUiPreferences(api, "melody_editor", {
      autoScroll,
      playbackRate,
      verticalZoom: rowHeight,
      volumes,
      zoom
    });
  }, [autoScroll, playbackRate, rowHeight, volumes, zoom]);

  const edit = useCallback(
    (next, record = true) =>
      dispatch({ type: "edit", notes: typeof next === "function" ? next(notes) : next, record }),
    [dispatch, notes]
  );
  const undo = useCallback(() => dispatch({ type: "undo" }), [dispatch]);
  const redo = useCallback(() => dispatch({ type: "redo" }), [dispatch]);
  const remove = useCallback(() => {
    if (!selected.length) return;
    edit(deleteNotes(notes, selected));
    setSelected([]);
  }, [edit, notes, selected]);
  const merge = useCallback(() => {
    const result = mergeSelectedNotes(notes, selected);
    if (result.notes === notes) return;
    edit(result.notes);
    setSelected([result.selectedId]);
  }, [edit, notes, selected]);
  const copy = useCallback(() => {
    clipboardRef.current = cloneNotes(selectedNotes(notes, selected));
  }, [notes, selected]);
  const insertCopies = useCallback(
    (sources, anchor, prefix) => {
      if (!sources.length) return;
      const first = Math.min(...sources.map(({ start }) => start));
      const stamp = Date.now();
      const copies = sources.map((note, index) => {
        const offset = anchor - first;
        return {
          ...note,
          _id: `${prefix}-${stamp}-${index}`,
          start: roundTime(note.start + offset),
          end: roundTime(note.end + offset),
          word_start: roundTime(note.word_start + offset),
          word_end: roundTime(note.word_end + offset)
        };
      });
      edit([...notes, ...copies]);
      setSelected(copies.map(({ _id }) => _id));
    },
    [edit, notes]
  );
  const paste = useCallback(() => {
    const copied = clipboardRef.current;
    if (!copied.length) return;
    const span =
      Math.max(...copied.map(({ end }) => end)) - Math.min(...copied.map(({ start }) => start));
    insertCopies(
      copied,
      clamp(transportRef.current.timeRef?.current || 0, 0, Math.max(0, duration - span)),
      "paste"
    );
  }, [duration, insertCopies, transportRef]);
  const duplicate = useCallback(() => {
    const chosen = selectedNotes(notes, selected);
    if (!chosen.length) return;
    const first = Math.min(...chosen.map(({ start }) => start));
    const last = Math.max(...chosen.map(({ end }) => end));
    const offset = Math.max(0.03, last - first);
    if (last + offset > duration) return;
    insertCopies(chosen, first + offset, "duplicate");
  }, [duration, insertCopies, notes, selected]);
  const selectAdjacent = useCallback(
    (direction) => {
      const id = adjacentNoteId(notes, selected, direction);
      if (!id) return;
      const note = notes.find(({ _id }) => _id === id);
      setSelected([id]);
      transportRef.current.seek?.(note.start);
      transportRef.current.tone?.(note.note);
    },
    [notes, selected, transportRef]
  );

  const selectWord = useCallback(
    (index, event) => {
      if (event?.shiftKey && wordSelectAnchor.current !== null) {
        const anchor = wordSelectAnchor.current;
        const lo = Math.min(anchor, index);
        const hi = Math.max(anchor, index);
        setSelectedWords(Array.from({ length: hi - lo + 1 }, (_, offset) => lo + offset));
        return;
      }
      wordSelectAnchor.current = index;
      setSelectedWords([index]);
    },
    []
  );

  const shiftWords = useCallback(
    (direction) => {
      if (!wordTexts.length || !selectedWords.length) return;
      const start = Math.min(...selectedWords);
      const end = Math.max(...selectedWords);
      const next = shiftWordTexts(wordTexts, [start, end], direction);
      if (next === wordTexts) return;
      dispatch({ type: "shiftWords", wordTexts: next });
      const moved = start + direction;
      const movedEnd = end + direction;
      setSelectedWords(Array.from({ length: movedEnd - moved + 1 }, (_, offset) => moved + offset));
      wordSelectAnchor.current = moved;
    },
    [dispatch, selectedWords, wordTexts]
  );

  const startWordResize = useCallback(
    (event, index, side) => {
      event.preventDefault();
      event.stopPropagation();
      wordDragRef.current = {
        index,
        side,
        x: event.clientX,
        snapshot: wordBounds.map((bound) => ({ ...bound })),
        moved: false
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [wordBounds]
  );

  const startDrag = useCallback(
    (event, note, mode = "move") => {
      event.preventDefault();
      event.stopPropagation();
      const additive = event.shiftKey || event.ctrlKey || event.metaKey;
      const ids = selected.includes(note._id)
        ? selected
        : additive
          ? [...selected, note._id]
          : [note._id];
      setSelected(ids);
      dragRef.current = {
        id: note._id,
        ids,
        mode,
        x: event.clientX,
        y: event.clientY,
        snapshot: cloneNotes(notes),
        originals: new Map(
          notes.filter(({ _id }) => ids.includes(_id)).map((item) => [item._id, { ...item }])
        ),
        moved: false
      };
      transportRef.current.tone?.(note.note);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [notes, selected, transportRef]
  );

  const movePointer = useCallback(
    (event) => {
      const wordDrag = wordDragRef.current;
      if (wordDrag) {
        const dx = (event.clientX - wordDrag.x) / zoom;
        wordDrag.moved ||= Math.abs(event.clientX - wordDrag.x) > 1;
        const original = wordDrag.snapshot[wordDrag.index];
        const limits = wordResizeBounds(wordDrag.snapshot, wordDrag.index, duration);
        dispatch({
          type: "resizeWord",
          wordBounds: wordDrag.snapshot.map((bound, index) => {
            if (index !== wordDrag.index) return bound;
            if (wordDrag.side === "left") {
              const start = clamp(original.start + dx, limits.minStart, limits.maxStart);
              return { ...bound, start: roundTime(start) };
            }
            const end = clamp(original.end + dx, limits.minEnd, limits.maxEnd);
            return { ...bound, end: roundTime(end) };
          }),
          record: false
        });
        return;
      }
      const drag = dragRef.current;
      if (drag) {
        const dx = (event.clientX - drag.x) / zoom;
        const dy = event.shiftKey ? 0 : Math.round((drag.y - event.clientY) / rowHeight);
        drag.moved ||= Math.abs(event.clientX - drag.x) > 1 || Math.abs(event.clientY - drag.y) > 1;
        if (drag.mode === "move") {
          const safe = constrainedMoveDelta(drag.snapshot, drag.ids, dx);
          edit(
            notes.map((note) => {
              const original = drag.originals.get(note._id);
              return original
                ? {
                    ...note,
                    start: roundTime(original.start + safe),
                    end: roundTime(original.end + safe),
                    note: clamp(original.note + dy, 0, 127)
                  }
                : note;
            }),
            false
          );
        } else {
          const original = drag.originals.get(drag.id);
          const bounds = resizeBounds(drag.snapshot, drag.id);
          const changed =
            drag.mode === "left"
              ? { start: roundTime(clamp(original.start + dx, bounds.minStart, bounds.maxStart)) }
              : { end: roundTime(clamp(original.end + dx, bounds.minEnd, bounds.maxEnd)) };
          edit(
            notes.map((note) => (note._id === drag.id ? { ...note, ...changed } : note)),
            false
          );
        }
        return;
      }
      const marquee = marqueeRef.current;
      if (!marquee || marquee.pointerId !== event.pointerId) return;
      const rect = surfaceRef.current.getBoundingClientRect();
      marquee.x2 = event.clientX - rect.left;
      marquee.y2 = event.clientY - rect.top;
      setSelectionBox({ ...marquee });
      const hits = marqueeHitIds({
        notes,
        ...marquee,
        keyboardWidth,
        zoom,
        rowHeight,
        maxMidi
      });
      setSelected([...new Set([...marquee.base, ...hits])]);
    },
    [dispatch, duration, edit, keyboardWidth, maxMidi, notes, rowHeight, zoom]
  );

  const endPointer = useCallback(() => {
    const wordDrag = wordDragRef.current;
    if (wordDrag?.moved) dispatch({ type: "remember", wordBounds: wordDrag.snapshot });
    wordDragRef.current = null;
    const drag = dragRef.current;
    if (drag?.moved) dispatch({ type: "remember", notes: drag.snapshot });
    dragRef.current = null;
    marqueeRef.current = null;
    setSelectionBox(null);
  }, [dispatch]);

  const startMarquee = useCallback(
    (event) => {
      if (
        event.button !== 0 ||
        event.target.closest?.('[data-role="editor-note"], [data-role="editor-word"]')
      )
        return;
      const rect = surfaceRef.current.getBoundingClientRect();
      const x = event.clientX - rect.left;
      if (x < keyboardWidth) return;
      const additive = event.shiftKey || event.ctrlKey || event.metaKey;
      const value = {
        pointerId: event.pointerId,
        x1: x,
        y1: event.clientY - rect.top,
        x2: x,
        y2: event.clientY - rect.top,
        base: additive ? selected : []
      };
      marqueeRef.current = value;
      setSelectionBox(value);
      if (!additive) setSelected([]);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [keyboardWidth, selected]
  );

  const nudge = useCallback(
    (seconds, pitch = 0) => {
      if (!selected.length) return;
      const safe = constrainedMoveDelta(notes, selected, seconds);
      edit(
        notes.map((note) =>
          selected.includes(note._id)
            ? {
                ...note,
                start: roundTime(note.start + safe),
                end: roundTime(note.end + safe),
                note: clamp(note.note + pitch, 0, 127)
              }
            : note
        )
      );
    },
    [edit, notes, selected]
  );

  useEffect(() => {
    const hotkey = (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
        return;
      const modifier = event.ctrlKey || event.metaKey;
      const { code } = event;
      if (modifier && code === "KeyS") save();
      else if (modifier && code === "KeyZ") (event.shiftKey ? redo : undo)();
      else if (modifier && code === "KeyY") redo();
      else if (modifier && code === "KeyA") setSelected(notes.map(({ _id }) => _id));
      else if (modifier && code === "KeyC") copy();
      else if (modifier && code === "KeyX") {
        copy();
        remove();
      } else if (modifier && code === "KeyV") paste();
      else if (modifier && code === "KeyD") duplicate();
      else if (["Delete", "Backspace"].includes(event.key)) remove();
      else if (code === "Space")
        (transportRef.current.playing ? transportRef.current.pause : transportRef.current.play)?.();
      else if (event.key === "Home") transportRef.current.seek?.(0);
      else if (event.key === "End") transportRef.current.seek?.(duration);
      else if (event.altKey && selectedWords.length && event.key === "ArrowLeft") shiftWords(-1);
      else if (event.altKey && selectedWords.length && event.key === "ArrowRight") shiftWords(1);
      else if (event.key === "ArrowLeft")
        modifier ? nudge(event.shiftKey ? -0.25 : -0.05) : selectAdjacent(-1);
      else if (event.key === "ArrowRight")
        modifier ? nudge(event.shiftKey ? 0.25 : 0.05) : selectAdjacent(1);
      else if (event.key === "ArrowUp" && selected.length) nudge(0, event.shiftKey ? 12 : 1);
      else if (event.key === "ArrowDown" && selected.length) nudge(0, event.shiftKey ? -12 : -1);
      else if (event.key === "Escape") {
        setSelected([]);
        setSelectedWords([]);
      } else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", hotkey);
    return () => window.removeEventListener("keydown", hotkey);
  }, [
    copy,
    duplicate,
    duration,
    notes,
    nudge,
    paste,
    redo,
    remove,
    save,
    selectAdjacent,
    selected,
    selectedWords,
    shiftWords,
    transportRef,
    undo
  ]);

  return {
    autoScroll,
    canMerge: canMergeSelectedNotes(notes, selected),
    duration,
    endPointer,
    keyboardWidth,
    laneHeight,
    laneWidth,
    maxMidi,
    merge,
    minMidi,
    movePointer,
    notes,
    playbackRate,
    playheadRef,
    redo,
    remove,
    rowHeight,
    selected,
    selectionBox,
    selectWord,
    selectedWords,
    setAutoScroll,
    setPlaybackRate,
    setRowHeight,
    setSelected,
    setVolumes,
    setZoom,
    shellRef,
    shiftWords,
    startDrag,
    startMarquee,
    startWordResize,
    surfaceRef,
    undo,
    volumes,
    words,
    zoom
  };
}

const selectedNotes = (notes, ids) => {
  const selected = new Set(ids);
  return notes.filter(({ _id }) => selected.has(_id));
};
