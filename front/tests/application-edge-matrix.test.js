import assert from "node:assert/strict";
import test from "node:test";
import {
  clampNumber,
  normalizeBoolean,
  normalizeModel,
  normalizeNonNegativeNumber,
  normalizeRecording,
  normalizeSong,
  normalizeString
} from "../src/api/normalizers.js";
import { getErrorMessage } from "../src/utils/errors.js";
import { resolveTheme } from "../src/utils/theme.js";
import {
  buildLyricsData,
  getSelectedSong,
  lyricsToText,
  normalizeText,
  parseLyricsText
} from "../src/pages/Library/song-settings/utils.js";

const hostileValues = [
  null,
  undefined,
  NaN,
  Infinity,
  -Infinity,
  "",
  "   ",
  "false",
  "true",
  "0",
  "1",
  0,
  1,
  -1,
  [],
  {},
  [1],
  { value: 1 }
];

for (const value of hostileValues) {
  test(`normalizeString is stable for ${String(value)}`, () => {
    assert.equal(typeof normalizeString(value, "fallback"), "string");
  });

  test(`normalizeNonNegativeNumber is finite for ${String(value)}`, () => {
    const result = normalizeNonNegativeNumber(value, 7);
    assert.equal(Number.isFinite(result), true);
    assert.equal(result >= 0, true);
  });

  test(`normalizeSong is stable for ${String(value)}`, () => {
    const song = normalizeSong(value);
    assert.equal(typeof song.id, "string");
    assert.equal(typeof song.title, "string");
    assert.equal(Number.isFinite(song.progress_percent), true);
    assert.equal(
      song.progress_percent >= 0 && song.progress_percent <= 100,
      true
    );
  });

  test(`normalizeModel is stable for ${String(value)}`, () => {
    const model = normalizeModel(value);
    assert.equal(typeof model.name, "string");
    assert.equal(typeof model.downloaded, "boolean");
    assert.equal(typeof model.selected, "boolean");
    assert.equal(Number.isFinite(model.size), true);
  });

  test(`normalizeRecording is stable for ${String(value)}`, () => {
    const recording = normalizeRecording(value);
    assert.equal(typeof recording.id, "string");
    assert.equal(typeof recording.song_id, "string");
    assert.equal(Number.isFinite(recording.duration_sec), true);
  });

  test(`resolveTheme never throws for ${String(value)}`, () => {
    assert.equal(typeof resolveTheme(value), "string");
  });

  test(`normalizeText is null or string for ${String(value)}`, () => {
    const result = normalizeText(value);
    assert.equal(result === null || typeof result === "string", true);
  });
}

const booleanCases = [
  [true, true],
  [false, false],
  [1, true],
  [0, false],
  [-1, true],
  ["true", true],
  ["TRUE", true],
  [" yes ", true],
  ["on", true],
  ["1", true],
  ["false", false],
  ["FALSE", false],
  [" no ", false],
  ["off", false],
  ["0", false],
  ["", false],
  ["unknown", false],
  [null, false],
  [undefined, false],
  [Infinity, false]
];
for (const [value, expected] of booleanCases) {
  test(`normalizeBoolean(${String(value)})`, () => {
    assert.equal(normalizeBoolean(value), expected);
  });
}

const clampCases = [
  [-100, 0, 10, 0],
  [-1, 0, 10, 0],
  [0, 0, 10, 0],
  [5, 0, 10, 5],
  [10, 0, 10, 10],
  [11, 0, 10, 10],
  [100, 0, 10, 10],
  ["5", 0, 10, 5],
  [NaN, 0, 10, 0],
  [Infinity, 0, 10, 0],
  [undefined, 2, 5, 2]
];
for (const [value, min, max, expected] of clampCases) {
  test(`clampNumber ${String(value)} to ${min}-${max}`, () => {
    assert.equal(clampNumber(value, min, max), expected);
  });
}

const errorCases = [
  [new Error("boom"), "boom"],
  [" boom ", "boom"],
  [{ message: " object error " }, "object error"],
  [null, "fallback"],
  [undefined, "fallback"],
  [{}, "fallback"],
  [0, "fallback"],
  [false, "fallback"]
];
for (const [value, expected] of errorCases) {
  test(`getErrorMessage ${String(value)}`, () => {
    assert.equal(getErrorMessage(value, "fallback"), expected);
  });
}

const lyricInputs = [
  null,
  undefined,
  0,
  false,
  {},
  [],
  "",
  "a",
  "a\n b \n\n c"
];
for (const value of lyricInputs) {
  test(`parseLyricsText handles ${String(value)}`, () => {
    const result = parseLyricsText(value);
    assert.equal(Array.isArray(result), true);
    assert.equal(
      result.every((line) => typeof line === "string" && line.length),
      true
    );
  });
}

test("song settings helpers reject malformed collections", () => {
  assert.equal(getSelectedSong(null, "x"), undefined);
  assert.equal(getSelectedSong([null, { id: "x" }], "x").id, "x");
  assert.equal(lyricsToText(null), "");
  assert.equal(lyricsToText([null, { text: "ok" }]), "ok");
  assert.deepEqual(buildLyricsData(null, null), []);
});
