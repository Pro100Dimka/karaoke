import { expect, test } from "vitest";
import {
  adjacentNoteId,
  canMergeSelectedNotes,
  canonicalLyricProjection,
  constrainedMoveDelta,
  deleteNotes,
  documentReducer,
  initialDocument,
  marqueeHitIds,
  mergeSelectedNotes,
  normalizeNotes,
  resizeBounds,
  roundTime,
  serializeNotes
} from "../src/pages/MelodyEditor/model.js";

const note = (id, start, end, pitch = 60, word = 0) => ({
  _id: id,
  note: pitch,
  start,
  end,
  word_index: word,
  word_start: word * 2,
  word_end: word * 2 + 2
});

test("normalizes, clamps, sorts and rejects invalid or overlapping notes", () => {
  const result = normalizeNotes([
    note("late", 1.2, 1.8, 64),
    note("first", -1, 0.8),
    note("overlap", 0.5, 1.4, 62),
    { ...note("invalid", 0, 1), note: 128 },
    { ...note("empty", 1, 1), _id: "" }
  ]);
  expect(result.map(({ _id }) => _id)).toEqual(["first", "late"]);
  expect(result[0].start).toBe(0);
  expect(normalizeNotes([{ ...note("", 0, 1), _id: "" }])[0]._id).toContain("note-0");
  expect(normalizeNotes()).toEqual([]);
  expect(
    normalizeNotes([
      note("zero", 0, 0.2, 0),
      note("top", 0.2, 0.4, 127),
      note("negative", 0.4, 0.6, -1),
      note("fraction", 0.6, 0.8, 60.5),
      { ...note("bad-word", 0.8, 1), word_index: 0.5 }
    ]).map(({ _id }) => _id)
  ).toEqual(["zero", "top"]);
  expect(normalizeNotes([note("higher", 0, 0.2, 64), note("lower", 2, 2.2, 60, 1)]).map(({ _id }) => _id)).toEqual(["higher", "lower"]);
  expect(normalizeNotes([note("high", 0, 0.2, 72), note("low", 0.2, 0.4, 48)]).map(({ note: pitch }) => pitch)).toEqual([72, 48]);
  expect(normalizeNotes([note("higher-pitch", 0, 0.2, 72), note("lower-pitch", 0, 0.2, 48)]).map(({ _id }) => _id)).toEqual([
    "lower-pitch"
  ]);
});

test("merges only notes from the same word and deletes selected notes", () => {
  const notes = [note("a", 0, 0.5, 60), note("b", 0.5, 1, 64), note("c", 2, 3, 70, 1)];
  expect(canMergeSelectedNotes(notes, ["a", "b"])).toBe(true);
  const merged = mergeSelectedNotes(notes, ["a", "b"]);
  expect(merged.selectedId).toBe("a");
  expect(merged.notes.map(({ _id }) => _id)).toEqual(["a", "c"]);
  expect(merged.notes.find(({ _id }) => _id === "a")).toMatchObject({ start: 0, end: 1, note: 62 });
  expect(mergeSelectedNotes(notes, ["a", "c"]).notes).toBe(notes);
  expect(mergeSelectedNotes(notes, []).selectedId).toBeNull();
  expect(mergeSelectedNotes(notes, ["a"]).selectedId).toBe("a");
  expect(canMergeSelectedNotes(notes, ["a"])).toBe(false);
  expect(deleteNotes(notes, ["b"]).map(({ _id }) => _id)).toEqual(["a", "c"]);
});

test("finds adjacent notes in both directions and without an existing selection", () => {
  const notes = [note("b", 1, 1.5), note("a", 0, 0.5)];
  expect(adjacentNoteId(notes, [], 1)).toBe("a");
  expect(adjacentNoteId(notes, [], -1)).toBe("b");
  expect(adjacentNoteId(notes, ["a"], 1)).toBe("b");
  expect(adjacentNoteId(notes, ["b"], -1)).toBe("a");
  expect(adjacentNoteId(notes, ["a", "b"], 1)).toBe("b");
  expect(adjacentNoteId(notes, ["a", "b"], -1)).toBe("a");
  expect(adjacentNoteId(notes, ["b"], 1)).toBe("b");
  expect(adjacentNoteId(notes, ["a"], -1)).toBe("a");
  expect(adjacentNoteId(notes, ["a"], 0)).toBe("a");
  expect(adjacentNoteId([], [], 1)).toBeNull();
});

test("constrains movement and resizing to the word and neighbouring notes", () => {
  const notes = [note("a", 0.2, 0.6), note("b", 0.8, 1.2)];
  expect(constrainedMoveDelta(notes, ["a"], -1)).toBeCloseTo(-0.2);
  expect(constrainedMoveDelta(notes, ["a"], 1)).toBeCloseTo(0.2);
  expect(constrainedMoveDelta(notes, [], 1)).toBe(0);
  expect(constrainedMoveDelta([note("a", 0.2, 0.5), note("b", 0.7, 1), note("other", 2, 3, 70, 1)], ["a", "b"], 2)).toBe(1);
  expect(constrainedMoveDelta([note("previous", 0, 0.2), note("moving", 0.2, 0.5), note("next", 0.5, 0.8)], ["moving"], -1)).toBe(0);
  expect(constrainedMoveDelta([note("previous", 0, 0.2), note("moving", 0.2, 0.5), note("next", 0.5, 0.8)], ["moving"], 1)).toBe(0);
  expect(resizeBounds(notes, "a")).toEqual({
    minStart: 0,
    maxStart: 0.57,
    minEnd: 0.23,
    maxEnd: 0.8
  });
  expect(resizeBounds(notes, "missing")).toBeNull();
  expect(resizeBounds([note("previous", 0, 0.2), ...notes], "b").minStart).toBe(0.6);
  expect(resizeBounds([note("previous", 0, 0.2), note("moving", 0.2, 0.5), note("next", 0.5, 0.8)], "moving")).toMatchObject({
    minStart: 0.2,
    maxEnd: 0.5
  });
  expect(resizeBounds([note("moving", 0.2, 0.5), note("other-word", 2, 3, 70, 1)], "moving")).toMatchObject({
    minStart: 0,
    maxEnd: 2
  });
});

test("projects canonical lyrics and detects marquee intersections", () => {
  expect(canonicalLyricProjection([{ text: "Я", start: "1", end: "2" }])).toEqual([{ index: 0, text: "Я", start: 1, end: 2 }]);
  expect(canonicalLyricProjection()).toEqual([]);
  expect(canonicalLyricProjection([{ start: 0, end: 1 }])[0].text).toBe("");
  expect(
    marqueeHitIds({
      notes: [note("hit", 0, 1, 60), note("miss", 2, 3, 72, 1)],
      x1: 80,
      y1: 10,
      x2: 200,
      y2: 40,
      keyboardWidth: 80,
      zoom: 100,
      rowHeight: 10,
      maxMidi: 62
    })
  ).toEqual(["hit"]);
  const bounds = {
    notes: [note("edge", 0, 1, 60)],
    keyboardWidth: 80,
    zoom: 100,
    rowHeight: 10,
    maxMidi: 62
  };
  expect(marqueeHitIds({ ...bounds, x1: 180, x2: 180, y1: 20, y2: 30 })).toEqual(["edge"]);
  expect(marqueeHitIds({ ...bounds, x1: 181, x2: 200, y1: 31, y2: 40 })).toEqual([]);
  expect(marqueeHitIds({ ...bounds, x1: 0, x2: 79, y1: 20, y2: 30 })).toEqual([]);
  expect(marqueeHitIds({ ...bounds, x1: 80, x2: 180, y1: 0, y2: 19 })).toEqual([]);
  expect(marqueeHitIds({ ...bounds, x1: 80, x2: 180, y1: 31, y2: 40 })).toEqual([]);
});

test("document history records commits and previews without losing redo", () => {
  const first = [note("a", 0, 1)];
  const second = [note("a", 0, 1, 62)];
  let state = documentReducer(initialDocument, { type: "load", notes: first });
  state = documentReducer(state, { type: "edit", notes: second, record: true });
  expect(state.past).toHaveLength(1);
  state = documentReducer(state, { type: "undo" });
  expect(state.notes[0].note).toBe(60);
  expect(state.future).toHaveLength(1);
  state = documentReducer(state, { type: "redo" });
  expect(state.notes[0].note).toBe(62);
  const preview = documentReducer(state, { type: "edit", notes: first, record: false });
  expect(preview.past).toEqual(state.past);
  const remembered = documentReducer(preview, { type: "remember", notes: second });
  expect(remembered.past.at(-1)[0].note).toBe(62);
  expect(documentReducer(initialDocument, { type: "undo" })).toBe(initialDocument);
  expect(documentReducer(initialDocument, { type: "redo" })).toBe(initialDocument);
  const dirty = { notes: first, past: [second], future: [second] };
  expect(documentReducer(dirty, { type: "load", notes: first })).toMatchObject({
    past: [],
    future: []
  });
  let capped = initialDocument;
  for (let index = 0; index < 82; index += 1)
    capped = documentReducer(capped, {
      type: "edit",
      notes: [note(String(index), 0, 1)],
      record: true
    });
  expect(capped.past).toHaveLength(80);
  const undone = documentReducer(capped, { type: "undo" });
  expect(undone.past).toHaveLength(79);
  const redone = documentReducer(undone, { type: "redo" });
  expect(redone.future).toHaveLength(0);
  expect(redone.past).toHaveLength(80);
});

test("serializes only the backend note contract and rounds editor time", () => {
  expect(serializeNotes([{ ...note("a", 0, 1), extra: true }])).toEqual([{ note: 60, start: 0, end: 1, word_index: 0 }]);
  expect(roundTime(1.23456)).toBe(1.235);
});
