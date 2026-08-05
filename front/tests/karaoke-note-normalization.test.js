import assert from "node:assert/strict";
import test from "node:test";
import { normalizeNoteList } from "../src/pages/Karaoke/utils/note-normalization.js";

const malformed = [
  null,
  undefined,
  1,
  "note",
  {},
  { start: 0, end: -1, midi: 60 }
];
for (const value of malformed) {
  test(`normalizeNoteList rejects malformed entry ${String(value)}`, () => {
    assert.deepEqual(normalizeNoteList([value]), []);
  });
}

test("normalizeNoteList uses direct midi values", () => {
  assert.deepEqual(normalizeNoteList([{ start: "0", end: "1", midi: "60" }]), [
    { start: 0, end: 1, midi: 60 }
  ]);
});

test("normalizeNoteList uses pitch aliases", () => {
  assert.deepEqual(normalizeNoteList([{ start: 0, end: 1, pitch: 61 }]), [
    { start: 0, end: 1, midi: 61 }
  ]);
});

test("normalizeNoteList resolves named notes through the supplied resolver", () => {
  assert.deepEqual(
    normalizeNoteList([{ start: 0, end: 1, note: "C4" }], (note) =>
      note === "C4" ? 60 : NaN
    ),
    [{ start: 0, end: 1, midi: 60 }]
  );
});

test("normalizeNoteList default resolver safely rejects named notes", () => {
  assert.deepEqual(normalizeNoteList([{ start: 0, end: 1, note: "C4" }]), []);
});
