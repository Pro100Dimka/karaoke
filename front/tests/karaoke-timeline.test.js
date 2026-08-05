import assert from "node:assert/strict";
import test from "node:test";

import {
  getSeekTime,
  getTimelineProgress
} from "../src/pages/Karaoke/utils/timeline.js";

test("getTimelineProgress clamps invalid and out-of-range values", () => {
  assert.equal(getTimelineProgress(25, 100), 0.25);
  assert.equal(getTimelineProgress(-1, 100), 0);
  assert.equal(getTimelineProgress(200, 100), 1);
  assert.equal(getTimelineProgress(1, 0), 0);
});

test("getSeekTime converts pointer position and clamps to duration", () => {
  assert.equal(getSeekTime(150, 100, 200, 120), 30);
  assert.equal(getSeekTime(50, 100, 200, 120), 0);
  assert.equal(getSeekTime(400, 100, 200, 120), 120);
  assert.equal(getSeekTime(100, 100, 0, 120), null);
});
