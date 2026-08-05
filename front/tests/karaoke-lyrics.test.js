import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLyricWordTimings,
  getLyricDisplayState,
  getLyricFill
} from "../src/pages/Karaoke/utils/lyrics.js";

test("getLyricDisplayState selects current, upcoming and next lines", () => {
  const lyrics = [
    { start: 1, end: 3, text: "one" },
    { start: 4, end: 6, text: "two" },
    { start: 7, end: 9, text: "three" }
  ];

  assert.deepEqual(getLyricDisplayState(lyrics, 0), {
    currentLineIndex: -1,
    currentLine: null,
    upcomingLine: lyrics[0],
    nextLine: null
  });
  assert.deepEqual(getLyricDisplayState(lyrics, 4.5), {
    currentLineIndex: 1,
    currentLine: lyrics[1],
    upcomingLine: lyrics[2],
    nextLine: lyrics[2]
  });
});

test("buildLyricWordTimings preserves declared timings", () => {
  assert.deepEqual(
    buildLyricWordTimings({
      start: 0,
      end: 3,
      text: "hello world",
      words: [
        { text: "hello", start: 0.2, end: 1.1 },
        { text: "world", start: 1.2, end: 2.8 }
      ]
    }),
    [
      { text: "hello", start: 0.2, end: 1.1 },
      { text: "world", start: 1.2, end: 2.8 }
    ]
  );
});

test("buildLyricWordTimings distributes missing timings by word length", () => {
  const result = buildLyricWordTimings({ start: 10, end: 14, text: "a bbb" });
  assert.equal(result[0].start, 10);
  assert.equal(result[0].end, 11);
  assert.equal(result[1].start, 11);
  assert.equal(result[1].end, 14);
});

test("getLyricFill clamps before and after a word", () => {
  assert.equal(getLyricFill(0, 1, 2), 0);
  assert.equal(getLyricFill(1.5, 1, 2), 0.5);
  assert.equal(getLyricFill(3, 1, 2), 1);
  assert.equal(getLyricFill(Number.NaN, 1, 2), 0);
});
