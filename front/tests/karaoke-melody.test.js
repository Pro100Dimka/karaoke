import assert from "node:assert/strict";
import test from "node:test";

import {
  getMelodyCue,
  getMelodyRange,
  getVisibleNotes
} from "../src/pages/Karaoke/utils/melody.js";

test("getMelodyRange remains finite when song has no notes", () => {
  const range = getMelodyRange({ notes: [], keyShift: 0 });
  assert.deepEqual(range, { minMidi: 58, maxMidi: 62, pitchRange: 5 });
  assert.ok(Number.isFinite(range.minMidi));
  assert.ok(Number.isFinite(range.maxMidi));
});

test("getMelodyRange prefers saved song range and applies key shift", () => {
  assert.deepEqual(
    getMelodyRange({
      notes: [{ midi: 100 }],
      keyShift: 2,
      noteRangeMin: 48,
      noteRangeMax: 72
    }),
    { minMidi: 48, maxMidi: 76, pitchRange: 29 }
  );
});

test("getVisibleNotes includes notes touching window boundaries", () => {
  const notes = [
    { start: 0, end: 1 },
    { start: 2, end: 3 },
    { start: 4, end: 5 }
  ];
  assert.deepEqual(getVisibleNotes(notes, 1, 4), notes);
});

test("getMelodyCue selects active note before upcoming cue", () => {
  const notes = [
    { start: 1, end: 2, midi: 60 },
    { start: 2.5, end: 3, midi: 62 }
  ];
  assert.deepEqual(getMelodyCue({ notes, currentTime: 1.5, keyShift: 2 }), {
    activeNote: notes[0],
    activeMidi: 62,
    cueNote: notes[0],
    targetMidi: 62
  });
  assert.equal(
    getMelodyCue({ notes, currentTime: 2.2, keyShift: 0 }).targetMidi,
    62
  );
});
