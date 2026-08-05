import assert from "node:assert/strict";
import test from "node:test";
import {
  clampFinite,
  formatAudioTime,
  normalizeAudioDuration,
  normalizeAudioPosition,
  normalizeAudioVolume,
  toggleAudioPlayback
} from "../src/components/audio-player-utils.js";

const invalidValues = [
  null,
  undefined,
  NaN,
  Infinity,
  -Infinity,
  "bad",
  {},
  []
];

for (const value of invalidValues) {
  test(`audio helpers reject invalid value ${String(value)}`, () => {
    assert.equal(normalizeAudioDuration(value), 0);
    assert.equal(normalizeAudioPosition(value), 0);
    assert.equal(normalizeAudioVolume(value), 1);
    assert.equal(formatAudioTime(value), "00:00");
  });
}

for (const [value, expected] of [
  [-1, 0],
  [0, 0],
  [0.5, 0.5],
  [1, 1],
  [2, 1],
  ["0.25", 0.25]
]) {
  test(`normalizeAudioVolume(${String(value)})`, () => {
    assert.equal(normalizeAudioVolume(value), expected);
  });
}

for (const [value, duration, expected] of [
  [5, undefined, 5],
  [5, 10, 5],
  [15, 10, 10],
  [-1, 10, 0],
  [5, 0, 0],
  [5, NaN, 0],
  ["3.5", 10, 3.5]
]) {
  test(`normalizeAudioPosition(${String(value)}, ${String(duration)})`, () => {
    assert.equal(normalizeAudioPosition(value, duration), expected);
  });
}

for (const [value, expected] of [
  [0, "00:00"],
  [5.9, "00:05"],
  [65, "01:05"],
  [3605, "60:05"],
  ["125", "02:05"]
]) {
  test(`formatAudioTime(${String(value)})`, () => {
    assert.equal(formatAudioTime(value), expected);
  });
}

test("clampFinite constrains finite values", () => {
  assert.equal(clampFinite(-2, 0, 10, 4), 0);
  assert.equal(clampFinite(12, 0, 10, 4), 10);
  assert.equal(clampFinite(5, 0, 10, 4), 5);
  assert.equal(clampFinite(NaN, 0, 10, 4), 4);
});

test("toggleAudioPlayback is safe without an audio element", async () => {
  assert.equal(await toggleAudioPlayback(null), false);
});

test("toggleAudioPlayback pauses playing audio", async () => {
  let paused = false;
  const audio = {
    paused: false,
    pause: () => {
      paused = true;
    }
  };
  assert.equal(await toggleAudioPlayback(audio), false);
  assert.equal(paused, true);
});

test("toggleAudioPlayback starts paused audio", async () => {
  let played = false;
  const audio = {
    paused: true,
    play: async () => {
      played = true;
    }
  };
  assert.equal(await toggleAudioPlayback(audio), true);
  assert.equal(played, true);
});

test("toggleAudioPlayback absorbs autoplay rejection", async () => {
  const audio = {
    paused: true,
    play: async () => {
      throw new Error("blocked");
    }
  };
  assert.equal(await toggleAudioPlayback(audio), false);
});
