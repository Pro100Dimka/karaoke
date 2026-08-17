/* @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";
import {
  BLACK_KEYS,
  EDITOR_STORAGE_KEY,
  clamp,
  cloneNotes,
  editorPreferences,
  normalizeEditorNotes,
  noteName,
  roundTime,
  useEditorHistory
} from "../src/pages/Library/modals/song-settings/melody-editor-state.js";

beforeEach(() => localStorage.clear());

const note = (id, start, end, midi = 60, extra = {}) => ({
  _id: id,
  start,
  end,
  midi_note: midi,
  ...extra
});

describe("melody editor state primitives", () => {
  test("exports exact keyboard, storage and numeric contracts", () => {
    expect(BLACK_KEYS).toEqual([1, 3, 6, 8, 10]);
    expect(EDITOR_STORAGE_KEY).toBe("karaoke-melody-editor");
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(roundTime(1.2344)).toBe(1.234);
    expect(roundTime(1.2346)).toBe(1.235);
  });

  test("formats MIDI names across octaves and negative values", () => {
    expect(noteName(60)).toBe("C4");
    expect(noteName(61)).toBe("C#4");
    expect(noteName(69)).toBe("A4");
    expect(noteName(0)).toBe("C-1");
    expect(noteName(-1)).toBe("B-2");
    expect(noteName("72")).toBe("C5");
  });

  test("clones notes without sharing note objects", () => {
    const source = [note("a", 1, 2, 60, { text: "x" })];
    const cloned = cloneNotes(source);
    expect(cloned).toEqual(source);
    expect(cloned).not.toBe(source);
    expect(cloned[0]).not.toBe(source[0]);
    cloned[0].text = "changed";
    expect(source[0].text).toBe("x");
  });

  test("reads editor preferences from the canonical storage key", () => {
    localStorage.setItem(EDITOR_STORAGE_KEY, JSON.stringify({ zoom: 12, autoscroll: false }));
    expect(editorPreferences()).toEqual({ zoom: 12, autoscroll: false });
    localStorage.setItem(EDITOR_STORAGE_KEY, "broken-json");
    expect(editorPreferences()).toEqual({});
  });

  test("normalizes, filters and sorts raw editor notes deterministically", () => {
    const raw = [
      {
        start: "2",
        end: "3",
        midi: "64",
        velocity: 0,
        word_index: 0,
        syllable_index: 0,
        custom: "kept"
      },
      { _id: "early-high", start: 1, end: 2, midi_note: 70, velocity: "100" },
      { _id: "early-low", start: 1, end: 2, midi_note: 60 },
      { _id: "zero", start: 4, end: 4, midi_note: 55 },
      { _id: "reverse", start: 5, end: 4, midi_note: 55 },
      { _id: "fallbacks", start: "bad", end: 1, midi_note: null, velocity: null }
    ];
    const normalized = normalizeEditorNotes(raw);
    expect(normalized.map(({ _id }) => _id)).toEqual([
      "fallbacks",
      "early-low",
      "early-high",
      "note-0-2-3"
    ]);
    expect(normalized[0]).toMatchObject({
      start: 0,
      end: 1,
      midi_note: 60,
      velocity: 96,
      word_index: null,
      syllable_index: null
    });
    expect(normalized[3]).toMatchObject({
      start: 2,
      end: 3,
      midi_note: 64,
      velocity: 96,
      word_index: 0,
      syllable_index: 0,
      custom: "kept"
    });
    expect(normalizeEditorNotes()).toEqual([]);
  });
});

describe("melody editor history", () => {
  test("replace records undo snapshots, redo restores, and a new edit clears redo", () => {
    const initial = [note("a", 0, 1)];
    const hook = renderHook(() => useEditorHistory(initial));

    act(() => hook.result.current.replace([note("b", 1, 2, 62)]));
    expect(hook.result.current.notes.map(({ _id }) => _id)).toEqual(["b"]);
    act(() => hook.result.current.undo());
    expect(hook.result.current.notes.map(({ _id }) => _id)).toEqual(["a"]);
    act(() => hook.result.current.redo());
    expect(hook.result.current.notes.map(({ _id }) => _id)).toEqual(["b"]);

    act(() => hook.result.current.undo());
    act(() => hook.result.current.replace([note("c", 2, 3, 64)]));
    act(() => hook.result.current.redo());
    expect(hook.result.current.notes.map(({ _id }) => _id)).toEqual(["c"]);
  });

  test("functional replace receives current state and can skip history recording", () => {
    const hook = renderHook(() => useEditorHistory([note("a", 0, 1)]));
    act(() =>
      hook.result.current.replace(
        (current) => [...current, note("b", 2, 3)],
        false
      )
    );
    expect(hook.result.current.notes.map(({ _id }) => _id)).toEqual(["a", "b"]);
    act(() => hook.result.current.undo());
    expect(hook.result.current.notes.map(({ _id }) => _id)).toEqual(["a", "b"]);
  });

  test("reset clears both history stacks and normalizes replacement notes", () => {
    const hook = renderHook(() => useEditorHistory([note("a", 0, 1)]));
    act(() => hook.result.current.replace([note("b", 1, 2)]));
    act(() => hook.result.current.reset([{ _id: "z", start: "3", end: "4", midi: 65 }]));
    expect(hook.result.current.notes).toEqual([
      expect.objectContaining({ _id: "z", start: 3, end: 4, midi_note: 65 })
    ]);
    act(() => hook.result.current.undo());
    expect(hook.result.current.notes[0]._id).toBe("z");
    act(() => hook.result.current.redo());
    expect(hook.result.current.notes[0]._id).toBe("z");
  });

  test("remember installs an explicit undo snapshot", () => {
    const hook = renderHook(() => useEditorHistory([note("current", 0, 1)]));
    act(() => hook.result.current.remember([note("snapshot", 2, 3)]));
    act(() => hook.result.current.undo());
    expect(hook.result.current.notes.map(({ _id }) => _id)).toEqual(["snapshot"]);
    act(() => hook.result.current.redo());
    expect(hook.result.current.notes.map(({ _id }) => _id)).toEqual(["current"]);
  });

  test("history is capped at eighty snapshots", () => {
    const hook = renderHook(() => useEditorHistory([note("n0", 0, 1)]));
    for (let index = 1; index <= 82; index += 1) {
      act(() => hook.result.current.replace([note(`n${index}`, index, index + 1)]));
    }
    for (let index = 0; index < 80; index += 1) act(() => hook.result.current.undo());
    expect(hook.result.current.notes[0]._id).toBe("n2");
    act(() => hook.result.current.undo());
    expect(hook.result.current.notes[0]._id).toBe("n2");
  });
});
