import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTime,
  midiToWesternNote
} from "../src/pages/Karaoke/utils/format.js";
import { getErrorMessage } from "../src/utils/errors.js";

test("formatTime handles normal and invalid values", () => {
  assert.equal(formatTime(65.9), "1:05");
  assert.equal(formatTime(-1), "0:00");
  assert.equal(formatTime("120"), "2:00");
  assert.equal(formatTime(Number.NaN), "0:00");
});

test("midiToWesternNote rounds safely and supports negative values", () => {
  assert.equal(midiToWesternNote(60), "C4");
  assert.equal(midiToWesternNote(61.4), "C♯4");
  assert.equal(midiToWesternNote(-1), "B-2");
  assert.equal(midiToWesternNote(Number.NaN), "—");
});

test("getErrorMessage accepts unknown thrown values", () => {
  assert.equal(getErrorMessage(new Error(" failed ")), "failed");
  assert.equal(getErrorMessage(" text "), "text");
  assert.equal(getErrorMessage({ message: " object " }), "object");
  assert.equal(getErrorMessage(null, "fallback"), "fallback");
});
