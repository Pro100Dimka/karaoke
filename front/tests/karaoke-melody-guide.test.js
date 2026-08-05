import assert from "node:assert/strict";
import test from "node:test";
import {
  findActiveMelodyNote,
  getMelodyGuideState,
  midiToFrequency
} from "../src/pages/Karaoke/utils/melody-guide.js";

test("midiToFrequency maps reference and octave notes", () => {
  assert.equal(midiToFrequency(69), 440);
  assert.equal(midiToFrequency(81), 880);
  assert.equal(midiToFrequency(57), 220);
  assert.equal(midiToFrequency("bad"), null);
});

test("findActiveMelodyNote uses half-open note intervals", () => {
  const notes = [
    { start: 0, end: 1, midi: 60 },
    { start: 1, end: 2, midi: 62 }
  ];
  assert.equal(findActiveMelodyNote(notes, 0.999).midi, 60);
  assert.equal(findActiveMelodyNote(notes, 1).midi, 62);
  assert.equal(findActiveMelodyNote(notes, 2), null);
  assert.equal(findActiveMelodyNote(null, 1), null);
});

test("getMelodyGuideState computes frequency and quadratic gain", () => {
  const state = getMelodyGuideState({
    notes: [{ start: 0, end: 2, midi: 69 }],
    position: 1,
    keyShift: 12,
    volume: 0.5
  });
  assert.equal(state.active, true);
  assert.equal(state.frequency, 880);
  assert.equal(state.gain, 0.03);
});

test("getMelodyGuideState silences missing notes and clamps volume", () => {
  assert.deepEqual(getMelodyGuideState({ notes: [], position: 1, volume: 1 }), {
    active: false,
    note: null,
    frequency: null,
    gain: 0.0001
  });
  const state = getMelodyGuideState({
    notes: [{ start: 0, end: 2, midi: 69 }],
    position: 1,
    volume: 5
  });
  assert.equal(state.gain, 0.12);
  assert.equal(
    getMelodyGuideState({
      notes: [{ start: 0, end: 2, midi: "bad" }],
      position: 1,
      volume: 1
    }).active,
    false
  );
});
