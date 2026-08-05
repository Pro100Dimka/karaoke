import assert from "node:assert/strict";
import test from "node:test";
import {
  createPanoramaPath,
  getYouTubeVideoId,
  normalizeLyrics,
  normalizeNotes,
  noteNameToMidi,
  playbackGain,
  transposeKey,
  youTubeEmbedUrl
} from "../src/pages/Karaoke/utils/data.js";
import {
  createBrowserDeviceOptions,
  createBufferSizeOptions,
  createIndexedDeviceOptions
} from "../src/pages/Karaoke/utils/devices.js";
import {
  buildLyricWordTimings,
  getLyricDisplayState,
  getLyricFill
} from "../src/pages/Karaoke/utils/lyrics.js";
import {
  getMelodyCue,
  getMelodyRange,
  getVisibleNotes
} from "../src/pages/Karaoke/utils/melody.js";
import { detectMidiFromAnalyser } from "../src/pages/Karaoke/utils/pitch.js";
import {
  clampPlaybackPosition,
  createPlayerSyncCommand,
  getMicrophoneLevel,
  getSecondaryMediaPosition,
  shouldSyncMedia
} from "../src/pages/Karaoke/utils/transport.js";

test("noteNameToMidi supports flats, sharps and negative octaves", () => {
  assert.equal(noteNameToMidi("C-1"), 0);
  assert.equal(noteNameToMidi("Cb4"), 59);
  assert.equal(noteNameToMidi("B#3"), 60);
  assert.equal(noteNameToMidi(" H4 "), null);
});

test("normalizeLyrics ignores malformed lines and words", () => {
  assert.deepEqual(normalizeLyrics([null, undefined, 12]), []);
  const result = normalizeLyrics([
    {
      text: "hello",
      start: "1",
      end: "3",
      words: [
        null,
        { word: "hi", start: 1, end: 2 },
        { text: "", start: 2, end: 3 }
      ]
    }
  ]);
  assert.deepEqual(result, [
    {
      start: 1,
      end: 2,
      text: "hello",
      words: [{ text: "hi", start: 1, end: 2 }]
    }
  ]);
});

test("normalizeLyrics rejects non-array containers", () => {
  assert.deepEqual(normalizeLyrics({ lines: "bad" }), []);
  assert.deepEqual(normalizeLyrics({ segments: null }), []);
});

test("normalizeNotes tolerates malformed entries", () => {
  assert.deepEqual(
    normalizeNotes([null, {}, { start: 2, end: 1, midi: 60 }]),
    []
  );
  assert.deepEqual(normalizeNotes([{ start: 0, end: 1, note: "A4" }]), [
    { start: 0, end: 1, midi: 69 }
  ]);
});

test("transposeKey normalizes large and fractional shifts", () => {
  assert.equal(transposeKey("C minor", 13), "C# minor");
  assert.equal(transposeKey("C", -13), "B");
  assert.equal(transposeKey("C", 1.8), "D");
  assert.equal(transposeKey("unknown", 2), "unknown");
});

test("playbackGain clamps all numeric input", () => {
  assert.equal(playbackGain(-1), 0);
  assert.equal(playbackGain(2), 1);
  assert.equal(playbackGain("0.5"), 0.25);
  assert.equal(playbackGain(Number.NaN), 0);
});

test("YouTube parser accepts official hosts only", () => {
  assert.equal(
    getYouTubeVideoId("https://youtube.com/watch?v=dQw4w9WgXcQ"),
    "dQw4w9WgXcQ"
  );
  assert.equal(
    getYouTubeVideoId("https://music.youtube.com/watch?v=dQw4w9WgXcQ"),
    "dQw4w9WgXcQ"
  );
  assert.equal(
    getYouTubeVideoId("https://evil-youtube.com/watch?v=dQw4w9WgXcQ"),
    null
  );
  assert.equal(getYouTubeVideoId("javascript:alert(1)"), null);
  assert.match(
    youTubeEmbedUrl("dQw4w9WgXcQ"),
    /^https:\/\/www\.youtube\.com\/embed\//
  );
});

test("createPanoramaPath consumes exactly five random samples", () => {
  const samples = [0, 0.25, 0.5, 0.75, 1];
  let calls = 0;
  const path = createPanoramaPath(() => samples[calls++]);
  assert.equal(calls, 5);
  assert.equal(path.xPhaseA, 0);
  assert.equal(path.xPhaseB, Math.PI / 2);
  assert.equal(path.yPhaseB, Math.PI * 2);
});

test("device option helpers preserve defaults and filter invalid devices", () => {
  assert.deepEqual(
    createIndexedDeviceOptions([null, { index: 2, name: "Mic" }]),
    [
      { value: "", label: "По умолчанию" },
      { value: 2, label: "Mic" }
    ]
  );
  assert.deepEqual(
    createBrowserDeviceOptions([{ deviceId: "x", label: "Out" }], "Device"),
    [
      { value: "default", label: "Системное по умолчанию" },
      { value: "x", label: "Out" }
    ]
  );
  assert.deepEqual(createBufferSizeOptions([32, "64", -1, 0, "bad"]), [
    { value: 32, label: "32 samples" },
    { value: 64, label: "64 samples" }
  ]);
});

test("lyric state handles boundaries and unsorted input deterministically", () => {
  const lyrics = [
    { start: 5, end: 7, text: "two" },
    { start: 0, end: 5, text: "one" }
  ];
  const state = getLyricDisplayState(lyrics, 5);
  assert.equal(state.currentLine?.text, "two");
  assert.equal(state.currentLineIndex, 0);
});

test("lyric timings remain finite for invalid line ranges", () => {
  const timings = buildLyricWordTimings({
    start: "bad",
    end: null,
    text: "a bb"
  });
  assert.equal(timings.length, 2);
  assert.ok(
    timings.every(
      (word) => Number.isFinite(word.start) && Number.isFinite(word.end)
    )
  );
  assert.equal(getLyricFill("bad", 0, 1), 0);
});

test("melody helpers ignore malformed notes", () => {
  const range = getMelodyRange({
    notes: [null, { midi: "bad" }, { midi: 60 }]
  });
  assert.deepEqual(range, { minMidi: 58, maxMidi: 62, pitchRange: 5 });
  assert.deepEqual(getVisibleNotes([null, { start: 0, end: 1 }], 0, 1), [
    { start: 0, end: 1 }
  ]);
  assert.deepEqual(getMelodyCue({ notes: [null], currentTime: 0 }), {
    activeNote: null,
    activeMidi: null,
    cueNote: null,
    targetMidi: null
  });
});

test("pitch detection rejects invalid buffers and sample rates", () => {
  const analyser = { getFloatTimeDomainData() {} };
  assert.equal(
    detectMidiFromAnalyser(analyser, new Float32Array(), 44100),
    null
  );
  assert.equal(detectMidiFromAnalyser(analyser, new Float32Array(16), 0), null);
  assert.equal(detectMidiFromAnalyser(null, new Float32Array(16), 44100), null);
});

test("transport helpers stay finite under extreme values", () => {
  assert.equal(clampPlaybackPosition(Infinity, 10), 0);
  assert.equal(getSecondaryMediaPosition(Infinity, 10), 0);
  assert.equal(shouldSyncMedia(1, 2, -5), true);
  assert.deepEqual(createPlayerSyncCommand(undefined, null, Infinity), {
    type: "karaoke-player",
    action: undefined,
    songId: null,
    position: 0
  });
  assert.equal(getMicrophoneLevel({ rms_db: -Infinity }), 0);
});
