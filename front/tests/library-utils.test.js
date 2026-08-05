import assert from "node:assert/strict";
import test from "node:test";
import {
  formatEta,
  formatLibraryDate,
  formatRecordingDuration,
  getProcessingProgress,
  isProcessingActive
} from "../src/pages/Library/utils.js";

const etaCases = [
  [null, "рассчитываем…"],
  [undefined, "рассчитываем…"],
  [NaN, "рассчитываем…"],
  [Infinity, "рассчитываем…"],
  [-1, "рассчитываем…"],
  [0, "рассчитываем…"],
  [0.4, "рассчитываем…"],
  [1, "~1 сек"],
  [30.4, "~30 сек"],
  [30.6, "~31 сек"],
  [59.6, "~1 мин 0 сек"],
  [60, "~1 мин 0 сек"],
  [61, "~1 мин 1 сек"],
  [119.5, "~2 мин 0 сек"],
  [3601, "~60 мин 1 сек"]
];
for (const [input, expected] of etaCases) {
  test(`formatEta(${String(input)})`, () => {
    assert.equal(formatEta(input), expected);
  });
}

const durationCases = [
  [null, "0.0 сек"],
  [undefined, "0.0 сек"],
  [NaN, "0.0 сек"],
  [Infinity, "0.0 сек"],
  [-2, "0.0 сек"],
  [0, "0.0 сек"],
  [0.04, "0.0 сек"],
  [0.05, "0.1 сек"],
  [1, "1.0 сек"],
  [1.25, "1.3 сек"],
  ["2.5", "2.5 сек"]
];
for (const [input, expected] of durationCases) {
  test(`formatRecordingDuration(${String(input)})`, () => {
    assert.equal(formatRecordingDuration(input), expected);
  });
}

const progressCases = [
  [{ progress_percent: 50 }, null, 50],
  [{ progress_percent: -10 }, null, 0],
  [{ progress_percent: 120 }, null, 100],
  [{ progress_percent: "75" }, null, 75],
  [{ progress_percent: NaN }, null, 0],
  [{ progress_percent: Infinity }, null, 0],
  [{ progress_percent: null }, { progress_percent: 22 }, 22],
  [null, { progress_percent: 33 }, 33],
  [null, null, 0]
];
for (const [status, song, expected] of progressCases) {
  test(`getProcessingProgress case ${expected}`, () => {
    assert.equal(getProcessingProgress(status, song), expected);
  });
}

for (const status of ["processing", "queued"]) {
  test(`${status} is active`, () =>
    assert.equal(isProcessingActive(status), true));
}
for (const status of ["done", "error", "pending", "", null, undefined]) {
  test(`${String(status)} is not active`, () =>
    assert.equal(isProcessingActive(status), false));
}

test("formatLibraryDate rejects invalid values", () => {
  assert.equal(formatLibraryDate(null), "—");
  assert.equal(formatLibraryDate("not-a-date"), "—");
});

test("formatLibraryDate formats valid dates", () => {
  assert.notEqual(formatLibraryDate("2026-08-05T00:00:00Z"), "—");
});
