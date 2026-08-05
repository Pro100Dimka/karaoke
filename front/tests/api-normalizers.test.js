import assert from "node:assert/strict";
import test from "node:test";
import {
  clampNumber,
  normalizeModel,
  normalizeRecording,
  normalizeSong,
  normalizeSongList
} from "../src/api/normalizers.js";

test("clampNumber handles invalid and out-of-range values", () => {
  assert.equal(clampNumber("55", 0, 100), 55);
  assert.equal(clampNumber(150, 0, 100), 100);
  assert.equal(clampNumber(-5, 0, 100), 0);
  assert.equal(clampNumber("invalid", 0, 100, 10), 10);
});

test("normalizeSong supplies stable UI-safe fields", () => {
  assert.deepEqual(normalizeSong({ id: 7, title: " ", status: "unknown" }), {
    id: "7",
    title: "Без названия",
    status: "pending",
    progress_percent: 0,
    progress_step: "",
    error_message: null
  });
});

test("normalizeSongList accepts only arrays", () => {
  assert.deepEqual(normalizeSongList(null), []);
  assert.equal(normalizeSongList([{ title: "Track" }])[0].title, "Track");
});

test("model and recording normalizers constrain primitive fields", () => {
  assert.deepEqual(
    normalizeModel({ name: " tiny ", downloaded: 1, size: -2 }),
    {
      name: "tiny",
      downloaded: true,
      selected: false,
      size: 0
    }
  );
  assert.deepEqual(normalizeRecording({ id: 5, duration_sec: "12.5" }), {
    id: "5",
    song_id: "",
    duration_sec: 12.5
  });
});
