import assert from "node:assert/strict";
import test from "node:test";
import { getErrorMessage } from "../src/utils/errors.js";
import { resolveTheme } from "../src/utils/theme.js";
import {
  buildLyricsData,
  getSelectedSong,
  lyricsToText,
  normalizeText,
  parseLyricsText
} from "../src/pages/Library/modals/song-settings/utils.js";

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
  test(`resolveTheme never throws for ${String(value)}`, () => {
    assert.equal(typeof resolveTheme(value), "string");
  });

  test(`normalizeText is null or string for ${String(value)}`, () => {
    const result = normalizeText(value);
    assert.equal(result === null || typeof result === "string", true);
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
