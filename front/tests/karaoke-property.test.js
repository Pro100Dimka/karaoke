import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAudioEffects,
  normalizeAudioRuntimeSettings
} from "../src/pages/Karaoke/utils/audio-settings.js";
import {
  getYouTubeVideoId,
  normalizeLyrics,
  normalizeNotes,
  playbackGain,
  transposeKey,
  youTubeEmbedUrl
} from "../src/pages/Karaoke/utils/data.js";
import {
  createBrowserDeviceOptions,
  createBufferSizeOptions,
  createIndexedDeviceOptions
} from "../src/pages/Karaoke/utils/devices.js";
import { getKaraokeStageLayout } from "../src/pages/Karaoke/utils/layout.js";
import {
  buildLyricWordTimings,
  getLyricDisplayState,
  getLyricFill
} from "../src/pages/Karaoke/utils/lyrics.js";
import { getMelodyGuideState } from "../src/pages/Karaoke/utils/melody-guide.js";
import {
  getMelodyCue,
  getMelodyRange,
  getVisibleNotes
} from "../src/pages/Karaoke/utils/melody.js";
import { getPanoramaPosition } from "../src/pages/Karaoke/utils/panorama.js";
import { detectMidiFromAnalyser } from "../src/pages/Karaoke/utils/pitch.js";
import {
  getSeekTime,
  getTimelineProgress
} from "../src/pages/Karaoke/utils/timeline.js";
import {
  clampPlaybackPosition,
  getMicrophoneLevel,
  getSecondaryMediaPosition,
  shouldSyncMedia
} from "../src/pages/Karaoke/utils/transport.js";

const INVALID_VALUES = [
  undefined,
  null,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  "",
  "bad",
  {},
  [],
  true,
  false
];

function assertFiniteRecord(record, keys) {
  for (const key of keys) {
    assert.equal(Number.isFinite(record[key]), true, `${key} must be finite`);
  }
}

test("numeric helpers never return NaN or Infinity for hostile primitive input", () => {
  for (const value of INVALID_VALUES) {
    assert.equal(Number.isFinite(playbackGain(value)), true);
    assert.equal(Number.isFinite(getTimelineProgress(value, value)), true);
    assert.equal(Number.isFinite(clampPlaybackPosition(value, value)), true);
    assert.equal(
      Number.isFinite(getSecondaryMediaPosition(value, value)),
      true
    );
    assert.equal(Number.isFinite(getMicrophoneLevel({ rms_db: value })), true);
    assert.equal(Number.isFinite(getLyricFill(value, value, value)), true);
  }
});

test("audio settings always produce finite bounded runtime values", () => {
  for (const value of INVALID_VALUES) {
    const effects = normalizeAudioEffects({
      reverb: value,
      echo: value,
      delay: value
    });
    assertFiniteRecord(effects, ["reverb", "echo", "delay"]);
    assert.ok(effects.reverb >= 0 && effects.echo >= 0 && effects.delay >= 0);

    const runtime = normalizeAudioRuntimeSettings({
      volume: value,
      buffer_size: value,
      monitoring_enabled: value,
      output_device_id: value
    });
    assert.ok(runtime.volume >= 0 && runtime.volume <= 1);
    assert.equal(Number.isInteger(runtime.bufferSize), true);
    assert.ok(runtime.bufferSize > 0);
    assert.equal(typeof runtime.monitoringEnabled, "boolean");
    assert.ok(["string", "number"].includes(typeof runtime.outputDeviceId));
  }
});

test("string boolean settings are interpreted by value instead of truthiness", () => {
  assert.equal(
    normalizeAudioRuntimeSettings({ monitoring_enabled: "false" })
      .monitoringEnabled,
    false
  );
  assert.equal(
    normalizeAudioRuntimeSettings({ monitoring_enabled: "0" })
      .monitoringEnabled,
    false
  );
  assert.equal(
    normalizeAudioRuntimeSettings({ monitoring_enabled: "true" })
      .monitoringEnabled,
    true
  );
  assert.equal(
    normalizeAudioRuntimeSettings({ monitoring_enabled: "1" })
      .monitoringEnabled,
    true
  );
});

test("layout remains finite for every invalid dimension combination", () => {
  for (const value of INVALID_VALUES) {
    const layout = getKaraokeStageLayout({
      mainWidth: value,
      mainHeight: value,
      stageWidth: value,
      stageHeight: value,
      currentNavExtra: value
    });
    assertFiniteRecord(layout, ["navExtra", "videoWidth", "videoHeight"]);
    assert.ok(layout.navExtra >= 0);
    assert.ok(layout.videoWidth >= 2);
    assert.ok(layout.videoHeight >= 2);
  }
});

test("seek calculation rejects non-finite pointer geometry", () => {
  for (const value of [Number.NaN, Infinity, -Infinity, "bad", {}]) {
    assert.equal(getSeekTime(value, 0, 100, 10), null);
    assert.equal(getSeekTime(10, value, 100, 10), null);
  }
});

test("lyrics helpers tolerate malformed arrays and malformed word objects", () => {
  assert.doesNotThrow(() => getLyricDisplayState([null, 5, {}], 1));
  assert.doesNotThrow(() =>
    buildLyricWordTimings({
      start: 0,
      end: 2,
      words: [null, {}, { text: "ok" }]
    })
  );

  const timings = buildLyricWordTimings({
    start: 0,
    end: 2,
    words: [null, {}, { text: "ok" }]
  });
  assert.equal(timings.length, 1);
  assert.equal(timings[0].text, "ok");
  assertFiniteRecord(timings[0], ["start", "end"]);
});

test("normalized lyric words are chronological even when backend sends them unsorted", () => {
  const [line] = normalizeLyrics([
    {
      text: "one two",
      words: [
        { text: "two", start: 2, end: 3 },
        { text: "one", start: 0, end: 1 }
      ]
    }
  ]);
  assert.deepEqual(
    line.words.map((word) => word.text),
    ["one", "two"]
  );
  assert.equal(line.start, 0);
  assert.equal(line.end, 3);
});

test("melody helpers keep MIDI values numeric under string backend values", () => {
  const cue = getMelodyCue({
    notes: [{ start: "0", end: "1", midi: "60" }],
    currentTime: 0.5,
    keyShift: 2
  });
  assert.equal(cue.activeMidi, 62);
  assert.equal(cue.targetMidi, 62);

  const guide = getMelodyGuideState({
    notes: [{ start: 0, end: 1, midi: "69" }],
    position: 0.5,
    keyShift: "0",
    volume: 1
  });
  assert.equal(guide.active, true);
  assert.ok(Math.abs(guide.frequency - 440) < 0.001);
});

test("visible notes reject reversed intervals", () => {
  assert.deepEqual(
    getVisibleNotes(
      [
        { start: 2, end: 1, midi: 60 },
        { start: 0, end: 1, midi: 61 }
      ],
      0,
      2
    ),
    [{ start: 0, end: 1, midi: 61 }]
  );
});

test("melody range invariant holds across deterministic generated inputs", () => {
  let seed = 0x12345678;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };

  for (let run = 0; run < 250; run += 1) {
    const notes = Array.from({ length: Math.floor(random() * 20) }, () => ({
      midi: random() < 0.1 ? "bad" : Math.round(random() * 127),
      start: random() * 100,
      end: random() * 100
    }));
    const result = getMelodyRange({ notes, keyShift: random() * 24 - 12 });
    assertFiniteRecord(result, ["minMidi", "maxMidi", "pitchRange"]);
    assert.ok(result.maxMidi >= result.minMidi);
    assert.equal(result.pitchRange, result.maxMidi - result.minMidi + 1);
  }
});

test("transport invariants hold over a broad deterministic value matrix", () => {
  const values = [
    -100,
    -1,
    -0,
    0,
    0.01,
    1,
    10,
    100,
    "5",
    "bad",
    null,
    Infinity
  ];
  for (const time of values) {
    for (const duration of values) {
      const position = clampPlaybackPosition(time, duration);
      assert.equal(Number.isFinite(position), true);
      assert.ok(position >= 0);
      if (Number.isFinite(Number(duration)) && Number(duration) > 0) {
        assert.ok(position <= Number(duration));
      }
      assert.equal(typeof shouldSyncMedia(time, duration), "boolean");
    }
  }
});

test("panorama position is periodic for positive and negative cycle offsets", () => {
  const path = { xPhaseA: 1, xPhaseB: 2, xPhaseC: 3, yPhaseA: 4, yPhaseB: 5 };
  const cycle = 240000;
  for (const elapsed of [0, 1, 12345, cycle / 2]) {
    const base = getPanoramaPosition(elapsed, cycle, path);
    const plus = getPanoramaPosition(elapsed + cycle, cycle, path);
    const minus = getPanoramaPosition(elapsed - cycle, cycle, path);
    assert.ok(Math.abs(base.x - plus.x) < 1e-9);
    assert.ok(Math.abs(base.y - plus.y) < 1e-9);
    assert.ok(Math.abs(base.x - minus.x) < 1e-9);
    assert.ok(Math.abs(base.y - minus.y) < 1e-9);
  }
});

test("YouTube embed helper refuses invalid or injectable identifiers", () => {
  for (const value of [
    null,
    "",
    "../escape",
    "<script>alert(1)</script>",
    "too-short"
  ]) {
    assert.equal(youTubeEmbedUrl(value), null);
  }
  assert.equal(
    getYouTubeVideoId("https://youtube.com/watch?v=ABCDEFGHIJK"),
    "ABCDEFGHIJK"
  );
  assert.match(
    youTubeEmbedUrl("ABCDEFGHIJK"),
    /^https:\/\/www\.youtube\.com\/embed\/ABCDEFGHIJK\?/
  );
});

test("device option builders remove empty and duplicate selectable values", () => {
  assert.deepEqual(
    createBrowserDeviceOptions(
      [
        { deviceId: "", label: "Hidden" },
        { deviceId: "a", label: "One" },
        { deviceId: "a", label: "Duplicate" }
      ],
      "Device"
    ),
    [
      { value: "default", label: "Системное по умолчанию" },
      { value: "a", label: "One" }
    ]
  );
  assert.deepEqual(createBufferSizeOptions([64, 64, "64", 128]), [
    { value: 64, label: "64 samples" },
    { value: 128, label: "128 samples" }
  ]);
  assert.deepEqual(
    createIndexedDeviceOptions([
      { index: 0, name: "A" },
      { index: 0, name: "Duplicate" }
    ]),
    [
      { value: "", label: "По умолчанию" },
      { value: 0, label: "A" }
    ]
  );
});

test("pitch detector returns null instead of leaking analyser exceptions", () => {
  const analyser = {
    getFloatTimeDomainData() {
      throw new Error("device disconnected");
    }
  };
  assert.equal(
    detectMidiFromAnalyser(analyser, new Float32Array(256), 44100),
    null
  );
});

test("normalizers preserve finite output under generated malformed payloads", () => {
  let seed = 7;
  const random = () => {
    seed = (seed * 48271) % 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const junk = [null, undefined, "bad", {}, [], NaN, Infinity, -Infinity];

  for (let run = 0; run < 200; run += 1) {
    const pick = () => junk[Math.floor(random() * junk.length)];
    const rawLyrics = Array.from({ length: Math.floor(random() * 8) }, () =>
      random() < 0.5
        ? pick()
        : {
            text: random() < 0.5 ? "line" : pick(),
            start: random() < 0.5 ? random() * 10 : pick(),
            end: random() < 0.5 ? random() * 10 : pick(),
            words: [
              pick(),
              { text: "word", start: random(), end: random() + 1 }
            ]
          }
    );
    const rawNotes = Array.from({ length: Math.floor(random() * 8) }, () =>
      random() < 0.5
        ? pick()
        : { start: random(), end: random() + 1, midi: random() * 127 }
    );

    assert.doesNotThrow(() => normalizeLyrics(rawLyrics));
    assert.doesNotThrow(() => normalizeNotes(rawNotes));
    for (const line of normalizeLyrics(rawLyrics)) {
      assertFiniteRecord(line, ["start", "end"]);
      assert.ok(line.end >= line.start);
    }
    for (const note of normalizeNotes(rawNotes)) {
      assertFiniteRecord(note, ["start", "end", "midi"]);
      assert.ok(note.end >= note.start);
    }
  }
});

test("transpose preserves suffix and always returns a non-empty string", () => {
  const keys = ["C", "Db minor", "F# major", "Bb mixolydian", "unknown", ""];
  for (const key of keys) {
    for (let shift = -48; shift <= 48; shift += 0.5) {
      const value = transposeKey(key, shift);
      assert.equal(typeof value, "string");
      assert.ok(value.length > 0);
    }
  }
});
