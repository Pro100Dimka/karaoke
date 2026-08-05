import assert from "node:assert/strict";
import test from "node:test";
import {
  clampPlaybackPosition,
  createPlayerSyncCommand,
  getMicrophoneLevel,
  getSecondaryMediaPosition,
  shouldSyncMedia
} from "../src/pages/Karaoke/utils/transport.js";

test("clampPlaybackPosition constrains invalid and out-of-range positions", () => {
  assert.equal(clampPlaybackPosition(-3, 100), 0);
  assert.equal(clampPlaybackPosition(120, 100), 100);
  assert.equal(clampPlaybackPosition(25, 100), 25);
  assert.equal(clampPlaybackPosition("bad", 100), 0);
});

test("clampPlaybackPosition keeps positive positions when duration is unknown", () => {
  assert.equal(clampPlaybackPosition(12, 0), 12);
  assert.equal(clampPlaybackPosition(-2, null), 0);
});

test("shouldSyncMedia respects tolerance", () => {
  assert.equal(shouldSyncMedia(10, 10.04), false);
  assert.equal(shouldSyncMedia(10, 10.2), true);
  assert.equal(shouldSyncMedia(undefined, 10), false);
});

test("getSecondaryMediaPosition respects media duration", () => {
  assert.equal(getSecondaryMediaPosition(15, 10), 10);
  assert.equal(getSecondaryMediaPosition(-5, 10), 0);
  assert.equal(getSecondaryMediaPosition(7, Number.NaN), 7);
});

test("createPlayerSyncCommand produces a stable room command", () => {
  assert.deepEqual(createPlayerSyncCommand("seek", "song-1", 12.5), {
    type: "karaoke-player",
    action: "seek",
    songId: "song-1",
    position: 12.5
  });
  assert.equal(createPlayerSyncCommand("stop", "song-1", null).position, 0);
});

test("getMicrophoneLevel converts dB to a clamped percentage", () => {
  assert.equal(getMicrophoneLevel(null), 0);
  assert.equal(getMicrophoneLevel({ rms_db: -60 }), 0);
  assert.equal(getMicrophoneLevel({ rms_db: -30 }), 50);
  assert.equal(getMicrophoneLevel({ rms_db: 5 }), 100);
});
