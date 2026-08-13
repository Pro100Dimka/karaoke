import assert from "node:assert/strict";
import { describe, test, vi } from "vitest";

import {
  getAnalysisFeedback,
  normalizeAnalysisResult,
  normalizeAnalysisSection
} from "../src/pages/Karaoke/utils/analysis.js";
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
  formatSongKey,
  getSongActions
} from "../src/pages/Library/components/song-card/utils.js";
import {
  createSongPayload,
  getSelectedSong,
  normalizeText,
  validateSongSettings
} from "../src/pages/Library/modals/song-settings/utils.js";
import {
  FORM_FIELDS,
  audioDriverVisible,
  audioSelect,
  audioSlider,
  fieldType,
  formReadonly,
  monitorDisabled,
  multipleAudioDriversAvailable,
  opts,
  percent,
  preferenceSelect,
  radioField,
  speakerPlaying
} from "../src/pages/Settings/utils.js";

describe("analysis normalization and feedback", () => {
  test("normalizes corrupt sections and all feedback grades", () => {
    assert.deepEqual(normalizeAnalysisSection(null, 2), {
      label: null,
      start: null,
      end: null,
      accuracy_percent: null,
      mean_deviation_semitones: null,
      index: 2
    });
    const normalized = normalizeAnalysisResult({
      pitch_accuracy_percent: 120,
      mean_deviation_semitones: "2",
      sections: [
        null,
        { label: " best ", start: 1, end: 2, accuracy_percent: 90 },
        { start: 3, end: 2, accuracy_percent: -2 }
      ]
    });
    assert.equal(normalized.pitch_accuracy_percent, 100);
    assert.equal(normalized.sections[0].label, "best");
    assert.equal(normalized.sections[1].end, null);
    for (const accuracy of [null, 90, 75, 55, 30]) {
      const feedback = getAnalysisFeedback({
        pitch_accuracy_percent: accuracy,
        mean_deviation_semitones: accuracy === 90 ? 0.5 : 2,
        sections: [{ accuracy_percent: 20 }, { accuracy_percent: 80 }]
      });
      assert.ok(feedback.grade && feedback.advice);
      assert.equal(feedback.bestSection.accuracy_percent, 80);
      assert.equal(feedback.needsPractice.accuracy_percent, 20);
    }
    const empty = getAnalysisFeedback({ sections: [] });
    assert.equal(empty.bestSection, null);
  });
});

describe("karaoke data contracts", () => {
  test("parses notes, keys, gain and YouTube URLs", () => {
    assert.equal(noteNameToMidi("C4"), 60);
    assert.equal(noteNameToMidi("Db4"), 61);
    for (const value of [null, "bad", "C20"])
      assert.equal(noteNameToMidi(value), null);
    assert.equal(transposeKey("Db minor", 2), "D# minor");
    assert.equal(transposeKey("H", 1), "H");
    assert.equal(transposeKey("", 1).length > 0, true);
    assert.equal(transposeKey("C", "bad"), "C");
    assert.equal(playbackGain(0.5), 0.25);
    assert.equal(playbackGain(-2), 0);
    for (const url of [
      "https://youtu.be/abcdefghijk",
      "https://www.youtube.com/watch?v=abcdefghijk",
      "https://youtube-nocookie.com/embed/abcdefghijk",
      "https://m.youtube.com/shorts/abcdefghijk"
    ])
      assert.equal(getYouTubeVideoId(url), "abcdefghijk");
    for (const url of [
      null,
      "bad",
      "ftp://youtu.be/abcdefghijk",
      "https://example.com/abcdefghijk"
    ])
      assert.equal(getYouTubeVideoId(url), null);
    assert.match(youTubeEmbedUrl("abcdefghijk"), /embed\/abcdefghijk/);
    assert.equal(youTubeEmbedUrl("bad"), null);
    assert.equal(youTubeEmbedUrl(null), null);
    assert.deepEqual(
      createPanoramaPath(() => 0),
      {
        xPhaseA: 0,
        xPhaseB: 0,
        xPhaseC: 0,
        yPhaseA: 0,
        yPhaseB: 0
      }
    );
    assert.equal(
      normalizeNotes([{ start: 0, end: 1, note: "C4" }])[0].midi,
      60
    );
  });

  test("normalizes lyric aliases without changing source word order", () => {
    assert.deepEqual(normalizeLyrics(null), []);
    assert.deepEqual(normalizeLyrics({ lines: "bad" }), []);
    const result = normalizeLyrics({
      segments: [
        { line: "later", begin: 3, finish: 2 },
        {
          words: [
            { word: "first", start_time: 1, end_time: 1.5 },
            null,
            { text: "second", start: "", end: 2 },
            { text: " " }
          ]
        },
        { text: "untimed" },
        null
      ]
    });
    assert.equal(result.length, 2);
    assert.equal(result[0].text, "first second");
    assert.equal(result[0].end, 2);
    assert.equal(result[1].end, 5);
    assert.deepEqual(
      result[0].words.map((word) => word.text),
      ["first", "second"]
    );
  });
});

describe("lyrics, melody and pitch", () => {
  test("selects current/upcoming lyrics and clamps fill", () => {
    const lyrics = [
      { start: 2, end: 3, text: "two" },
      { start: 0, end: 1, text: "one" },
      { start: 0, end: -1 },
      null
    ];
    assert.equal(getLyricDisplayState(lyrics, 0.5).currentLine.text, "one");
    assert.equal(getLyricDisplayState(lyrics, 1.5).upcomingLine.text, "two");
    assert.equal(getLyricDisplayState(lyrics, "bad").currentLine.text, "one");
    assert.equal(getLyricFill(1, 0, 2), 0.5);
    assert.equal(getLyricFill("bad", 0, 2), 0);
    assert.equal(getLyricFill(2, 1, 1), 1);
    assert.equal(getLyricFill(0, 1, 1), 0);
  });

  test("computes melody bounds, visibility and cues", () => {
    const notes = [
      { start: 1, end: 2, midi: 62 },
      { start: 3, end: 4, midi: 70 },
      null
    ];
    assert.deepEqual(
      getMelodyRange({
        notes,
        keyShift: 1,
        noteRangeMin: 60,
        noteRangeMax: 65
      }),
      {
        minMidi: 59,
        maxMidi: 73,
        pitchRange: 15
      }
    );
    assert.equal(
      getMelodyRange({ notes: [], fallbackMidi: "bad" }).minMidi,
      58
    );
    assert.equal(
      getMelodyRange({ notes: [], noteRangeMin: 70, noteRangeMax: 60 }).minMidi,
      58
    );
    assert.deepEqual(getVisibleNotes(notes, "bad", 4), []);
    assert.equal(getVisibleNotes(notes, 2, 3).length, 2);
    assert.equal(
      getMelodyCue({ notes, currentTime: 1.5, keyShift: 2 }).activeMidi,
      64
    );
    assert.equal(getMelodyCue({ notes, currentTime: 2.5 }).targetMidi, 70);
    assert.equal(getMelodyCue({ notes, currentTime: 10 }).cueNote, null);
  });

  test("detects a stable tone and rejects invalid or quiet input", () => {
    const rate = 8000;
    const tone = new Float32Array(2048);
    for (let index = 0; index < tone.length; index += 1)
      tone[index] = Math.sin((2 * Math.PI * 440 * index) / rate) * 0.5;
    const analyser = { getFloatTimeDomainData: (buffer) => buffer.set(tone) };
    assert.ok(
      Math.abs(
        detectMidiFromAnalyser(analyser, new Float32Array(2048), rate) - 69
      ) < 0.2
    );
    assert.equal(detectMidiFromAnalyser(null, tone, rate), null);
    assert.equal(detectMidiFromAnalyser(analyser, [], rate), null);
    assert.equal(detectMidiFromAnalyser(analyser, tone, 0), null);
    assert.equal(
      detectMidiFromAnalyser(
        {
          getFloatTimeDomainData: () => {
            throw new Error("device");
          }
        },
        tone,
        rate
      ),
      null
    );
    assert.equal(
      detectMidiFromAnalyser(
        { getFloatTimeDomainData: (buffer) => buffer.fill(0) },
        tone,
        rate
      ),
      null
    );
    assert.equal(
      detectMidiFromAnalyser(analyser, new Float32Array(3), rate),
      null
    );
  });
});

describe("device, settings and song-card factories", () => {
  test("deduplicates device and buffer options", () => {
    assert.deepEqual(
      createIndexedDeviceOptions([
        { index: 1, name: "A" },
        { index: 1 },
        null,
        {}
      ]).slice(1),
      [{ value: 1, label: "A" }]
    );
    assert.deepEqual(
      createBrowserDeviceOptions(
        [{ deviceId: "x", label: "Mic" }, { deviceId: "" }],
        "Device"
      ).slice(1),
      [{ value: "x", label: "Mic" }]
    );
    assert.deepEqual(createBufferSizeOptions([64, "64", 0, 12.5, "bad"]), [
      { value: 64, label: "64 samples" }
    ]);
    assert.deepEqual(createBufferSizeOptions(null), []);
  });

  test("builds field contracts and predicates", () => {
    assert.deepEqual(opts([[1, "One"]]), [{ value: 1, label: "One" }]);
    assert.match(percent("Volume")({ value: 0.125 }), /13%/);
    const onChange = vi.fn();
    const onFieldBlur = vi.fn();
    const field = FORM_FIELDS.text("name");
    assert.equal(field.getValue({ form: { name: "x" } }), "x");
    field.setValue({ onChange }, "y");
    field.saveValue({ onFieldBlur }, "y");
    assert.deepEqual(onChange.mock.calls[0], ["name", "y"]);
    assert.deepEqual(onFieldBlur.mock.calls[0], ["name", "y"]);
    assert.equal(formReadonly("x").type, "readonly");
    assert.equal(
      fieldType((name, config) => ({ name, ...config }), "x")("a").type,
      "x"
    );
    const radio = { stationId: "a", setStation: vi.fn() };
    assert.equal(radioField("stationId").getValue({ radio }), "a");
    radioField("stationId").setValue({ radio }, "b");
    const audio = {
      values: { volume: 1, audio_driver: "asio" },
      preferences: { input: "x" },
      options: { devices: [1], audioDrivers: [1, 2] },
      states: { monitoringEnabled: true, speakerTestState: "playing" },
      updateBackend: vi.fn(),
      updatePreference: vi.fn()
    };
    audioSlider("volume").setValue({ audio }, 0.5);
    assert.equal(
      audioSelect("device", "devices").getOptions({ audio }).length,
      1
    );
    assert.deepEqual(preferenceSelect("input", [{ value: "x" }]).options, [
      { value: "x" }
    ]);
    assert.equal(monitorDisabled({ audio }), true);
    assert.equal(audioDriverVisible({ audio }), true);
    assert.equal(multipleAudioDriversAvailable({ audio }), true);
    assert.equal(speakerPlaying({ audio }), true);
  });

  test("validates song settings and dispatches card actions", () => {
    const songs = [
      { id: "a", title: "A" },
      { id: "b", title: "B" }
    ];
    assert.equal(getSelectedSong(songs, "b").id, "b");
    assert.equal(getSelectedSong(songs).id, "a");
    assert.equal(getSelectedSong(null), undefined);
    assert.equal(normalizeText(" x "), "x");
    assert.ok(validateSongSettings({ title: "" }));
    assert.ok(validateSongSettings({ title: "x", tempo_override: 0 }));
    assert.ok(
      validateSongSettings({
        title: "x",
        note_range_min: 90,
        note_range_max: 20
      })
    );
    assert.equal(
      validateSongSettings({ title: "x", tempo_override: 120 }),
      null
    );
    assert.deepEqual(
      createSongPayload(
        { title: "", artist: " A ", note_range_min: -2, note_range_max: 130 },
        songs[0]
      ),
      {
        title: "A",
        artist: "A",
        genre: null,
        key_override: null,
        tempo_override: null,
        note_range_min: 0,
        note_range_max: 127,
        difficulty_override: null,
        video_url: null
      }
    );
    assert.equal(formatSongKey("A minor"), "Am");
    assert.equal(formatSongKey("C major"), "Cmaj");
    assert.ok(formatSongKey(null));
    const callbacks = {
      onDelete: vi.fn(),
      onOpenFolder: vi.fn(),
      onOpenRecordings: vi.fn(),
      onOpenSettings: vi.fn(),
      onProcess: vi.fn(),
      onReprocess: vi.fn()
    };
    const ready = getSongActions({
      ...callbacks,
      canManageLibrary: true,
      isReady: true,
      song: songs[0]
    });
    assert.equal(ready.length, 5);
    ready.forEach((action) => action[3]());
    const pending = getSongActions({
      ...callbacks,
      canManageLibrary: true,
      isReady: false,
      isWorking: true,
      song: songs[0]
    });
    assert.equal(pending[0][5].disabled, true);
    assert.deepEqual(
      getSongActions({
        ...callbacks,
        canManageLibrary: false,
        isReady: false,
        song: songs[0]
      }),
      []
    );
  });
});
