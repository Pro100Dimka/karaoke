import assert from "node:assert/strict";
import { describe, test, vi } from "vitest";

import { translateSaved } from "../src/i18n/runtime.js";

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
import { getLyricDisplayState, getLyricFill } from "../src/pages/Karaoke/utils/lyrics.js";
import {
  getMelodyCue,
  getMelodyRange,
  getVisibleNotes
} from "../src/pages/Karaoke/utils/melody.js";
import {
  detectMidiFromAnalyser,
  findBestPitchLag,
  getPitchLagRange,
  hasSufficientPitchEnergy,
  isConfidentPitchScore,
  normalizedCorrelation,
  pitchFrequencyToMidi,
  refinePitchLag,
  rootMeanSquare,
  selectFundamentalLag
} from "../src/pages/Karaoke/utils/pitch.js";
import { formatSongKey, getSongActions } from "../src/pages/Library/components/song-card/utils.js";
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
import {
  MEMORY_ACTIONS,
  buildOptimizeOptions
} from "../src/pages/Settings/screens/memory/config.js";

describe("analysis normalization and feedback", () => {
  test("normalizes every nullable section field without inventing data", () => {
    assert.deepEqual(normalizeAnalysisSection(null, 2), {
      label: null,
      start: null,
      end: null,
      accuracy_percent: null,
      mean_deviation_semitones: null,
      index: 2
    });
    assert.deepEqual(
      normalizeAnalysisSection({
        label: "  ",
        start: "",
        end: "",
        accuracy_percent: "bad",
        mean_deviation_semitones: ""
      }),
      {
        label: null,
        start: null,
        end: null,
        accuracy_percent: null,
        mean_deviation_semitones: null,
        index: 0
      }
    );
    assert.deepEqual(
      normalizeAnalysisSection({
        label: 7,
        start: null,
        end: 2,
        accuracy_percent: -2,
        mean_deviation_semitones: "-0.5"
      }),
      {
        label: null,
        start: null,
        end: 2,
        accuracy_percent: 0,
        mean_deviation_semitones: -0.5,
        index: 0
      }
    );
    assert.equal(normalizeAnalysisSection({ start: 2, end: 2 }).end, 2);
    assert.equal(normalizeAnalysisSection({ start: 3, end: 2 }).end, null);
    assert.equal(normalizeAnalysisSection({ start: null, end: -1 }).end, -1);
    assert.equal(normalizeAnalysisSection({ label: " best " }).label, "best");
    for (const section of [false, "bad", 7])
      assert.deepEqual(normalizeAnalysisSection(section), {
        label: null,
        start: null,
        end: null,
        accuracy_percent: null,
        mean_deviation_semitones: null,
        index: 0
      });
  });

  test("normalizes result shape and removes malformed sections", () => {
    for (const result of [null, false, "bad"])
      assert.deepEqual(normalizeAnalysisResult(result), {
        pitch_accuracy_percent: null,
        mean_deviation_semitones: null,
        sections: []
      });
    assert.deepEqual(normalizeAnalysisResult({ sections: "bad" }).sections, []);
    const normalized = normalizeAnalysisResult({
      pitch_accuracy_percent: 120,
      mean_deviation_semitones: "2",
      sections: [
        null,
        "bad",
        { label: " best ", start: 1, end: 2, accuracy_percent: 90 },
        { start: 3, end: 2, accuracy_percent: -2 }
      ]
    });
    assert.equal(normalized.pitch_accuracy_percent, 100);
    assert.equal(normalized.mean_deviation_semitones, 2);
    assert.equal(normalized.sections.length, 2);
    assert.equal(normalized.sections[0].label, "best");
    assert.equal(normalized.sections[0].index, 0);
    assert.equal(normalized.sections[1].end, null);
  });

  test("selects scored, best and weakest sections with stable tie order", () => {
    const firstBest = { label: "first-best", accuracy_percent: 80 };
    const secondBest = { label: "second-best", accuracy_percent: 80 };
    const firstWorst = { label: "first-worst", accuracy_percent: 20 };
    const secondWorst = { label: "second-worst", accuracy_percent: 20 };
    const middle = { label: "middle", accuracy_percent: 50 };
    const feedback = getAnalysisFeedback({
      pitch_accuracy_percent: 70,
      sections: [
        { label: "unscored" },
        middle,
        firstBest,
        firstWorst,
        secondBest,
        secondWorst
      ]
    });
    assert.equal(feedback.scoredSections.length, 5);
    assert.deepEqual(
      feedback.scoredSections.map(({ label }) => label),
      ["middle", "first-best", "first-worst", "second-best", "second-worst"]
    );
    assert.equal(feedback.bestSection.label, "first-best");
    assert.equal(feedback.needsPractice.label, "first-worst");

    const empty = getAnalysisFeedback({ sections: [] });
    assert.equal(empty.bestSection, null);
    assert.equal(empty.needsPractice, null);
    assert.deepEqual(empty.scoredSections, []);
  });

  test("uses exact grade and advice boundaries", () => {
    const feedback = (accuracy, deviation) =>
      getAnalysisFeedback({ pitch_accuracy_percent: accuracy, mean_deviation_semitones: deviation });
    const noData = feedback(null, 2);
    const poor = feedback(49.99, 0);
    const potential = feedback(50, 0);
    const good = feedback(70, 0);
    const excellent = feedback(85, 0);

    assert.equal(noData.grade, translateSaved("Нет данных"));
    assert.equal(poor.grade, translateSaved("Нужно потренироваться"));
    assert.equal(potential.grade, translateSaved("Есть потенциал"));
    assert.equal(good.grade, translateSaved("Хороший результат"));
    assert.equal(excellent.grade, translateSaved("Отличное исполнение"));
    assert.equal(feedback(84.99, 0).grade, translateSaved("Хороший результат"));
    assert.equal(feedback(69.99, 0).grade, translateSaved("Есть потенциал"));

    assert.equal(
      noData.advice,
      translateSaved(
        "Не удалось определить достаточно пропетых нот. Попробуйте петь ближе к микрофону."
      )
    );
    assert.equal(
      poor.advice,
      translateSaved( "Повторите сложные фразы медленнее, ориентируясь на ноты на экране."
      )
    );
    assert.equal(
      feedback(70, null).advice,
      translateSaved( "Хорошая точность. Попробуйте сделать фразы ровнее по громкости и дыханию."
      )
    );
    assert.equal(feedback(70, 1).advice, feedback(70, null).advice);
    assert.equal(
      feedback(70, 1.01).advice,
      translateSaved( "Сфокусируйтесь на точном начале каждой фразы и удержании высоты ноты."
      )
    );
    assert.equal(feedback(69.99, 0).advice, poor.advice);
  });
});

describe("karaoke data contracts", () => {
  test("parses notes, keys, gain and YouTube URLs", () => {
    assert.equal(noteNameToMidi(" C4 "), 60);
    assert.equal(noteNameToMidi("C#4"), 61);
    assert.equal(noteNameToMidi("Db4"), 61);
    assert.equal(noteNameToMidi("c-1"), 0);
    assert.equal(noteNameToMidi("G9"), 127);
    for (const value of [null, "bad", "xC4", "C4x", "C-2", "C20", "G#9"])
      assert.equal(noteNameToMidi(value), null);
    assert.equal(transposeKey("Db minor", 2), "D# minor");
    const sharpKeys = [
      "C",
      "C#",
      "D",
      "D#",
      "E",
      "F",
      "F#",
      "G",
      "G#",
      "A",
      "A#",
      "B"
    ];
    sharpKeys.forEach((expected, shift) => assert.equal(transposeKey(" C ", shift), expected)
    );
    for (const [root, expected] of [
      ["C", "C"],
      ["C#", "C#"],
      ["Db", "C#"],
      ["D", "D"],
      ["D#", "D#"],
      ["Eb", "D#"],
      ["E", "E"],
      ["F", "F"],
      ["F#", "F#"],
      ["Gb", "F#"],
      ["G", "G"],
      ["G#", "G#"],
      ["Ab", "G#"],
      ["A", "A"],
      ["A#", "A#"],
      ["Bb", "A#"],
      ["B", "B"]
    ])
      assert.equal(transposeKey(root, 0), expected);
    assert.equal(transposeKey("C", -1), "B");
    assert.equal(transposeKey("C", 13), "C#");
    assert.equal(transposeKey("H", 1), "H");
    assert.equal(transposeKey("xC", 1), "xC");
    assert.equal(transposeKey("Cb", 1), "Cb");
    assert.equal(transposeKey("", 1).length > 0, true);
    assert.equal(transposeKey("C", "bad"), "C");
    assert.equal(playbackGain(0.5), 0.25);
    assert.equal(playbackGain(-2), 0);
    assert.equal(playbackGain("bad"), 0);
    for (const url of [
      "https://youtu.be/abcdefghijk",
      "http://youtu.be/abcdefghijk",
      "https://www.youtube.com/watch?v=abcdefghijk",
      "https://youtube-nocookie.com/embed/abcdefghijk",
      "https://privacy.youtube-nocookie.com/live/abcdefghijk",
      "https://m.youtube.com/shorts/abcdefghijk",
      "https://youtube.com/embed/abcdefghijk",
      "https://evilwww.youtube.com/watch?v=abcdefghijk"
    ])
      assert.equal(getYouTubeVideoId(url), "abcdefghijk");
    for (const url of [
      null,
      "",
      "bad",
      "ftp://youtu.be/abcdefghijk",
      "https://example.com/abcdefghijk",
      "https://youtube.com/watch?v=xabcdefghijk",
      "https://youtube.com/watch?v=abcdefghijkx",
      "https://youtube.com/watch",
      "https://youtube.com/prefix/embed/abcdefghijk"
    ])
      assert.equal(getYouTubeVideoId(url), null);
    assert.equal(
      youTubeEmbedUrl(" abcdefghijk "),
      "https://www.youtube.com/embed/abcdefghijk?enablejsapi=1&playsinline=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&cc_load_policy=0&rel=0&modestbranding=1&mute=1"
    );
    for (const id of ["bad", "xabcdefghijk", "abcdefghijkx", null, 7])
      assert.equal(youTubeEmbedUrl(id), null);
    assert.deepEqual(
      createPanoramaPath(() => 0),
      { xPhaseA: 0, xPhaseB: 0, xPhaseC: 0, yPhaseA: 0, yPhaseB: 0 }
    );
    assert.deepEqual(
      createPanoramaPath(() => 0.25),
      {
        xPhaseA: Math.PI / 2,
        xPhaseB: Math.PI / 2,
        xPhaseC: Math.PI / 2,
        yPhaseA: Math.PI / 2,
        yPhaseB: Math.PI / 2
      }
    );
    assert.equal( normalizeNotes([{ start: 0, end: 1, note: "C4" }])[0].midi, 60
    );
  });

  test("normalizes lyric aliases without changing source word order", () => {
    assert.deepEqual(normalizeLyrics(null), []);
    assert.deepEqual(normalizeLyrics({ lines: "bad" }), []);
    assert.deepEqual(normalizeLyrics({ lines: ["bad"] }), []);
    assert.deepEqual(normalizeLyrics({}), []);
    assert.deepEqual(normalizeLyrics([{ text: "bad", start: -1 }]), []);
    for (const startKey of [ "start", "start_sec", "start_time", "begin", "from" ])
      assert.deepEqual(
        normalizeLyrics([{ text: startKey, [startKey]: 1, end: 2 }]).map(
          ({ text, start, end }) => ({ text, start, end })
        ),
        [{ text: startKey, start: 1, end: 2 }]
      );
    for (const endKey of ["end", "end_sec", "end_time", "finish", "to"])
      assert.deepEqual(
        normalizeLyrics([{ text: endKey, start: 1, [endKey]: 2 }]).map(
          ({ text, start, end }) => ({ text, start, end })
        ),
        [{ text: endKey, start: 1, end: 2 }]
      );
    assert.deepEqual(
      normalizeLyrics([
        {
          text: "",
          start: null,
          start_sec: 1,
          end: "",
          end_sec: 4,
          words: [
            { word: " first ", start: 2, end: 2.5 },
            { word: 42, start: 1.5, end: 3 },
            { text: "last", start: 3, end: 3.5 },
            "invalid"
          ]
        }
      ]).map(({ text, start, end }) => ({ text, start, end })),
      [{ text: "first 42 last", start: 1, end: 4 }]
    );
    assert.deepEqual(
      normalizeLyrics([{ text: "zero", start: 0 }]).map(
        ({ text, start, end, words }) => ({ text, start, end, words })
      ),
      [{ text: "zero", start: 0, end: 2, words: [] }]
    );
    assert.deepEqual(
      normalizeLyrics([
        {
          words: [
            { text: "later", start: 2, end: 3 },
            { text: "earlier", start: 1, end: 4 },
            { text: "untimed" }
          ]
        }
      ]).map(({ text, start, end }) => ({ text, start, end })),
      [{ text: "later earlier untimed", start: 1, end: 4 }]
    );
    assert.deepEqual(
      normalizeLyrics([ { text: "first", start: 1, end: 1 }, { text: "second", start: 1, end: 1 } ]).map(({ end }) => end),
      [3, 3]
    );
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
    assert.deepEqual( result[0].words.map((word) => word.text), ["first", "second"]
    );
    assert.deepEqual(
      normalizeLyrics([ { text: "first", start: 1, end: 1 }, { text: "second", start: 2, end: 3 } ]).map(({ text, start, end }) => ({ text, start, end })),
      [ { text: "first", start: 1, end: 2 }, { text: "second", start: 2, end: 3 } ]
    );
    assert.deepEqual(
      normalizeLyrics([
        { text: "later", start: 1, end: 3 },
        { text: "shorter", start: 1, end: 2 },
        { text: "same", start: 1, end: 2 }
      ]).map(({ text }) => text),
      ["shorter", "same", "later"]
    );
  });
});

describe("lyrics, melody and pitch", () => {
  test("accepts every supported lyric time alias", () => {
    for (const startKey of [ "start", "start_sec", "start_time", "begin", "from" ]) {
      const state = getLyricDisplayState( [{ [startKey]: 1, end: 2, text: startKey }], 1.5
      );
      assert.equal(state.currentLine.text, startKey);
      assert.equal(state.currentLine.start, 1);
    }
    for (const endKey of ["end", "end_sec", "end_time", "finish", "to"]) {
      const state = getLyricDisplayState( [{ start: 1, [endKey]: 2, text: endKey }], 1.5
      );
      assert.equal(state.currentLine.text, endKey);
      assert.equal(state.currentLine.end, 2);
    }
  });

  test("skips invalid time aliases and malformed lines", () => {
    const lyrics = [
      null,
      false,
      "bad",
      { start: null, start_sec: 1, end: "", end_sec: 2, text: "nulls" },
      { start: -1, begin: 2, end: Infinity, finish: 3, text: "fallbacks" },
      { start: "bad", end: 3, text: "invalid-start" },
      { start: 3, end: "bad", text: "invalid-end" },
      { start: 4, end: 3, text: "reversed" }
    ];
    const nulls = getLyricDisplayState(lyrics, 1.5).currentLine;
    assert.equal(nulls.text, "nulls");
    assert.equal(nulls.start, 1);
    assert.equal(nulls.end, 2);
    const fallbacks = getLyricDisplayState(lyrics, 2.5).currentLine;
    assert.equal(fallbacks.text, "fallbacks");
    assert.equal(fallbacks.start, 2);
    assert.equal(fallbacks.end, 3);
    const emptyState = {
      currentLineIndex: -1,
      currentLine: null,
      upcomingLine: null,
      nextLine: null
    };
    for (const invalid of [
      null,
      false,
      "bad",
      { start: "bad", end: 3 },
      { start: 0, end: "bad" },
      { start: 4, end: 3 }
    ])
      assert.deepEqual(getLyricDisplayState([invalid], -1), emptyState);
    assert.deepEqual(getLyricDisplayState(null, 1), {
      currentLineIndex: -1,
      currentLine: null,
      upcomingLine: null,
      nextLine: null
    });
  });

  test("selects current, upcoming and next lyrics at exact boundaries", () => {
    const lyrics = [
      { start: 2, end: 3, text: "three" },
      { start: 0, end: 1, text: "one" },
      { start: 1, end: 2, text: "two" },
      { start: 1, end: 1.5, text: "short-overlap" }
    ];
    const before = getLyricDisplayState(lyrics, -1);
    assert.equal(before.currentLineIndex, -1);
    assert.equal(before.upcomingLine.text, "one");
    assert.equal(before.nextLine.text, "short-overlap");

    const first = getLyricDisplayState(lyrics, 0.5);
    assert.equal(first.currentLineIndex, 0);
    assert.equal(first.currentLine.text, "one");
    assert.equal(first.upcomingLine.text, "short-overlap");
    assert.equal(first.nextLine.text, "short-overlap");

    const boundary = getLyricDisplayState(lyrics, 1);
    assert.equal(boundary.currentLine.text, "two");
    assert.equal(boundary.upcomingLine.text, "three");
    assert.equal(boundary.nextLine.text, "three");

    const gap = getLyricDisplayState(
      [ { start: 0, end: 1, text: "past" }, { start: 2, end: 3, text: "future" } ],
      1.5
    );
    assert.equal(gap.currentLine, null);
    assert.equal(gap.upcomingLine.text, "future");
    assert.equal(gap.nextLine, null);
    assert.equal(getLyricDisplayState(lyrics, "bad").currentLine.text, "one");

    const zeroDuration = getLyricDisplayState( [{ start: 1, end: 1, text: "instant" }], 0
    );
    assert.equal(zeroDuration.upcomingLine.text, "instant");
    assert.deepEqual(
      getLyricDisplayState([{ start: 1, end: 2, text: "ended" }], 2),
      { currentLineIndex: -1, currentLine: null, upcomingLine: null, nextLine: null }
    );
  });

  test("calculates lyric fill for invalid, regular and zero durations", () => {
    for (const args of [ ["bad", 0, 1], [0, "bad", 1], [0, 0, "bad"] ])
      assert.equal(getLyricFill(...args), 0);
    assert.equal(getLyricFill(-1, 0, 2), 0);
    assert.equal(getLyricFill(1, 0, 2), 0.5);
    assert.equal(getLyricFill(3, 2, 6), 0.25);
    assert.equal(getLyricFill(3, 0, 2), 1);
    assert.equal(getLyricFill(0, 1, 1), 0);
    assert.equal(getLyricFill(1, 1, 1), 1);
    assert.equal(getLyricFill(1, 2, 1), 1);
    assert.equal(getLyricFill(0, 2, 1), 0);
  });

  test("computes melody range from saved, actual and fallback values", () => {
    assert.deepEqual(
      getMelodyRange({
        notes: [null, "bad", { midi: "40" }, { midi: 80 }],
        keyShift: 2,
        noteRangeMin: 50,
        noteRangeMax: 70
      }),
      { minMidi: 40, maxMidi: 84, pitchRange: 45 }
    );
    assert.deepEqual(
      getMelodyRange({ notes: [], keyShift: 1, noteRangeMin: 60, noteRangeMax: 60 }),
      { minMidi: 59, maxMidi: 63, pitchRange: 5 }
    );
    assert.deepEqual(
      getMelodyRange({ notes: [{ midi: 60 }], fallbackMidi: 90 }),
      { minMidi: 58, maxMidi: 62, pitchRange: 5 }
    );
    for (const [noteRangeMin, noteRangeMax] of [
      [null, 70],
      [50, null],
      [-10, null],
      ["bad", 70],
      [50, Infinity],
      [70, 60]
    ])
      assert.deepEqual(
        getMelodyRange({
          notes: null,
          keyShift: "bad",
          noteRangeMin,
          noteRangeMax,
          fallbackMidi: 69.5
        }),
        { minMidi: 67, maxMidi: 72, pitchRange: 6 }
      );
    assert.deepEqual(getMelodyRange({ notes: [], fallbackMidi: "bad" }), {
      minMidi: 58,
      maxMidi: 62,
      pitchRange: 5
    });
    assert.deepEqual(
      getMelodyRange({ notes: [{ midi: 60 }], keyShift: 2, noteRangeMin: 50, noteRangeMax: 70 }),
      { minMidi: 50, maxMidi: 74, pitchRange: 25 }
    );
    assert.deepEqual(
      getMelodyRange({ notes: [], noteRangeMin: -20, noteRangeMax: -10 }),
      { minMidi: -22, maxMidi: -8, pitchRange: 15 }
    );
  });

  test("selects visible notes including exact viewport boundaries", () => {
    assert.deepEqual(getVisibleNotes([{ start: 1, end: 2 }], "bad", 4), []);
    assert.deepEqual(getVisibleNotes([], 0, "bad"), []);
    assert.deepEqual(getVisibleNotes([{ start: 1, end: 2 }], -Infinity, 4), []);
    assert.deepEqual(getVisibleNotes([{ start: 1, end: 2 }], 0, Infinity), []);
    assert.deepEqual(getVisibleNotes(null, 0, 4), []);
    const visible = getVisibleNotes(
      [
        null,
        { id: "bad-start", start: "bad", end: 1 },
        { id: "bad-end", start: 1, end: "bad" },
        { id: "infinite-start", start: -Infinity, end: 2 },
        { id: "infinite-end", start: 1, end: Infinity },
        { id: "reversed", start: 2, end: 1 },
        { id: "left", start: -2, end: -1 },
        { id: "end-boundary", start: 0, end: 1 },
        { id: "inside", start: 1, end: 2 },
        { id: "zero", start: 2, end: 2 },
        { id: "start-boundary", start: 3, end: 4 },
        { id: "right", start: 4, end: 5 }
      ],
      1,
      3
    );
    assert.deepEqual(
      visible.map(({ id }) => id),
      ["end-boundary", "inside", "zero", "start-boundary"]
    );
  });

  test("selects active, imminent and just-ended melody cues", () => {
    const notes = [
      { start: 1, end: 2, midi: 62, id: "a" },
      { start: 3, end: 4, midi: 70, id: "b" }
    ];
    const active = getMelodyCue({ notes, currentTime: 1, keyShift: 2 });
    assert.equal(active.activeNote.id, "a");
    assert.equal(active.activeMidi, 64);
    assert.equal(active.cueNote.id, "a");
    assert.equal(active.targetMidi, 64);

    const upcoming = getMelodyCue({ notes, currentTime: 2 });
    assert.equal(upcoming.activeNote, null);
    assert.equal(upcoming.activeMidi, null);
    assert.equal(upcoming.cueNote.id, "b");
    assert.equal(upcoming.targetMidi, 70);

    const ended = getMelodyCue({ notes, currentTime: 4 });
    assert.equal(ended.activeNote, null);
    assert.equal(ended.cueNote.id, "b");
    assert.equal(getMelodyCue({ notes, currentTime: 4.01 }).cueNote, null);
    assert.equal( getMelodyCue({ notes, currentTime: "bad", keyShift: "bad" }).targetMidi, 62
    );

    assert.equal(
      getMelodyCue({ notes: [{ start: 0.92, end: 0.99, midi: 60 }], currentTime: 1 }).targetMidi,
      60
    );
    assert.equal(
      getMelodyCue({ notes: [{ start: 0.919, end: 0.99, midi: 60 }], currentTime: 1 }).cueNote,
      null
    );
  });

  test("calculates normalized pitch correlation and lag boundaries", () => {
    assert.equal( normalizedCorrelation(Float32Array.of(1, 2, 3, 4), 1), 20 / Math.sqrt(14 * 29)
    );
    assert.equal(normalizedCorrelation(Float32Array.of(1, 0, 0), 1), 0);
    assert.equal(rootMeanSquare(Float32Array.of(3, 4)), Math.sqrt(12.5));
    assert.equal(hasSufficientPitchEnergy([0.01]), true);
    assert.equal(hasSufficientPitchEnergy([0.009]), false);
    assert.equal(isConfidentPitchScore(0.62), true);
    assert.equal(isConfidentPitchScore(0.619), false);
    assert.deepEqual(getPitchLagRange(2048, 48_000), { minLag: 26, maxLag: 874 });
    assert.equal(getPitchLagRange(3, 48_000), null);
    assert.deepEqual(getPitchLagRange(100, 48_000), { minLag: 26, maxLag: 98 });
    assert.equal(getPitchLagRange(28, 48_000), null);
  });

  test("selects the earliest strongest pitch lag and first valid peak", () => {
    const scores = Float64Array.of(0, 0, 0.5, 0.8, 0.7, 0.8, 0.6, 0);
    assert.deepEqual(findBestPitchLag(scores, 2, 6), { lag: 3, score: 0.8 });
    assert.deepEqual(findBestPitchLag(new Float64Array(5), 1, 3), { lag: -1, score: 0 });
    assert.deepEqual(
      findBestPitchLag(Float64Array.of(0, 0, 0.5, 0.6, 0.7, 0.8, 0.9), 2, 6),
      { lag: 6, score: 0.9 }
    );

    const weak = Float64Array.of(0, 0, 0.6, 0.7, 0.6, 0, 0.6, 0);
    assert.deepEqual(selectFundamentalLag(weak, 1, 7, 7, 1), { lag: 7, score: 1 });
    const exact = Float64Array.of(0, 0.9, 0.9, 0.8, 0, 0, 1, 0);
    assert.deepEqual(selectFundamentalLag(exact, 1, 7, 6, 1), { lag: 2, score: 0.9 });
    const rightTie = Float64Array.of(0, 0.8, 0.9, 0.9, 0, 0, 1, 0);
    assert.deepEqual(selectFundamentalLag(rightTie, 1, 7, 6, 1), { lag: 3, score: 0.9 });
  });

  test("interpolates pitch lag and converts bounded frequencies to MIDI", () => {
    const scores = Float64Array.of(0, 0, 0, 0, 0.8, 1, 0.9, 0, 0);
    assert.ok(Math.abs(refinePitchLag(scores, 5, 2, 8) - 5.1666666667) < 1e-9);
    assert.equal(refinePitchLag(scores, 2, 2, 8), 2);
    assert.equal(refinePitchLag(scores, 8, 2, 8), 8);
    assert.equal(refinePitchLag(Float64Array.of(0, 0.5, 1, 0.8), 2, 2, 3), 2);
    assert.equal( refinePitchLag( Float64Array.of(0, 0, 0, 0, 0, 0, 0, 0.8, 1, 0.5), 8, 2, 8 ), 8
    );
    assert.equal(refinePitchLag(Float64Array.of(0, 1, 1, 1, 0), 2, 0, 4), 2);
    for (const [frequency, midi] of [
      [54, 33],
      [55 * 0.98, 33],
      [55, 33],
      [440, 69],
      [1760, 93],
      [1790, 93],
      [1760 * 1.02, 93]
    ])
      assert.ok(Math.abs(pitchFrequencyToMidi(frequency) - midi) < 1e-9);
    for (const frequency of [NaN, Infinity, 53, 1800])
      assert.equal(pitchFrequencyToMidi(frequency), null);
  });

  test("detects a stable tone and rejects invalid or quiet input", () => {
    const rate = 48_000;
    const length = 2048;
    const detect = (samples, sampleRate = rate) =>
      detectMidiFromAnalyser(
        { getFloatTimeDomainData: (buffer) => buffer.set(samples) },
        new Float32Array(samples.length),
        sampleRate
      );
    const sine = (frequency, amplitude = 0.5, envelope = () => 1) => {
      const samples = new Float32Array(length);
      for (let index = 0; index < samples.length; index += 1)
        samples[index] =
          amplitude *
          envelope(index) *
          Math.sin((2 * Math.PI * frequency * index) / rate);
      return samples;
    };

    for (const [frequency, midi] of [
      [55, 33],
      [82.4069, 40],
      [110, 45],
      [220, 57],
      [261.6256, 60],
      [329.6276, 64],
      [440, 69],
      [880, 81],
      [1760, 93]
    ])
      assert.ok(Math.abs(detect(sine(frequency)) - midi) < 0.03, frequency);

    const harmonic = new Float32Array(length);
    for (let index = 0; index < harmonic.length; index += 1)
      harmonic[index] =
        0.35 * Math.sin((2 * Math.PI * 220 * index) / rate) +
        0.2 * Math.sin((2 * Math.PI * 440 * index) / rate) +
        0.1 * Math.sin((2 * Math.PI * 660 * index) / rate);
    assert.ok(Math.abs(detect(harmonic) - 57) < 0.03);
    assert.ok(
      Math.abs( detect(sine(261.6256, 0.5, (index) => Math.exp(-index / length))) - 60
      ) < 0.03
    );

    assert.equal(detect(sine(53)), null);
    assert.equal(detect(sine(1800)), null);
    assert.equal(detect(sine(440, 0.014)), null);
    assert.ok(Math.abs(detect(sine(440, 0.0142)) - 69) < 0.03);

    const tone = sine(440);
    const analyser = { getFloatTimeDomainData: (buffer) => buffer.set(tone) };
    const unread = vi.fn();
    for (const [buffer, sampleRate] of [
      [null, rate],
      [[], rate],
      [tone, NaN],
      [tone, Infinity],
      [tone, 0],
      [tone, -1]
    ])
      assert.equal(
        detectMidiFromAnalyser( { getFloatTimeDomainData: unread }, buffer, sampleRate
        ),
        null
      );
    assert.equal(unread.mock.calls.length, 0);
    for (const [device, buffer, sampleRate] of [
      [null, tone, rate],
      [{}, tone, rate],
      [analyser, null, rate]
    ])
      assert.equal(detectMidiFromAnalyser(device, buffer, sampleRate), null);
    assert.equal(
      detectMidiFromAnalyser(
        { getFloatTimeDomainData: () => { throw new Error("device"); } },
        tone,
        rate
      ),
      null
    );
    assert.equal(
      detectMidiFromAnalyser(
        { getFloatTimeDomainData: (buffer) => buffer.fill(0) },
        new Float32Array(length),
        rate
      ),
      null
    );
    assert.equal(
      detectMidiFromAnalyser(
        { getFloatTimeDomainData: (buffer) => buffer.fill(0.5) },
        new Float32Array(3),
        rate
      ),
      null
    );
    const impulse = new Float32Array(length);
    impulse[0] = 1;
    assert.equal(
      detectMidiFromAnalyser(
        { getFloatTimeDomainData: (buffer) => buffer.set(impulse) },
        new Float32Array(length),
        rate
      ),
      null
    );
    let seed = 1;
    const noise = new Float32Array(length);
    for (let index = 0; index < noise.length; index += 1) {
      seed = (seed * 16_807) % 2_147_483_647;
      noise[index] = (seed / 2_147_483_647 - 0.5) * 0.5;
    }
    assert.equal(detect(noise), null);
  }, 30_000);
});

describe("device, settings and song-card factories", () => {
  test("deduplicates device and buffer options", () => {
    assert.deepEqual(createIndexedDeviceOptions(null, "Default"), [
      { value: "", label: "Default" }
    ]);
    assert.deepEqual(
      createIndexedDeviceOptions(
        [
          "invalid",
          { index: 0, label: "Zero" },
          { index: 1, name: "A" },
          { index: 1 },
          { index: 2 },
          null,
          {}
        ],
        "Default"
      ),
      [
        { value: "", label: "Default" },
        { value: 0, label: "Zero" },
        { value: 1, label: "A" },
        { value: 2, label: translateSaved("Устройство") }
      ]
    );
    assert.deepEqual(
      createBrowserDeviceOptions(
        [ "invalid", { deviceId: "x", label: "Mic" }, { deviceId: "y" }, { deviceId: "" } ],
        "Device",
        "Browser default"
      ),
      [
        { value: "default", label: "Browser default" },
        { value: "x", label: "Mic" },
        { value: "y", label: "Device" }
      ]
    );
    assert.deepEqual(createBufferSizeOptions([64, "64", 0, 12.5, "bad"]), [
      { value: 64, label: "64 samples" }
    ]);
    assert.deepEqual(createBufferSizeOptions(null), []);
    assert.deepEqual(
      createBufferSizeOptions(),
      [32, 64, 128, 256, 512].map((value) => ({
        value,
        label: `${value} samples`
      }))
    );
    assert.equal( createIndexedDeviceOptions(null)[0].label, translateSaved("По умолчанию")
    );
    assert.equal(
      createBrowserDeviceOptions([], "Device")[0].label,
      translateSaved("Системное по умолчанию")
    );
  });

  test("builds field contracts and predicates", () => {
    assert.deepEqual(opts([[1, "One"]]), [{ value: 1, label: "One" }]);
    assert.match(percent("Volume")({ value: 0.125 }), /13%/);
    assert.match(percent("Volume")({ value: null }), /0%/);
    const onChange = vi.fn();
    const onFieldBlur = vi.fn();
    const field = FORM_FIELDS.text("name");
    assert.equal(field.getValue({ form: { name: "x" } }), "x");
    field.setValue({ onChange }, "y");
    field.saveValue({ onFieldBlur }, "y");
    assert.deepEqual(onChange.mock.calls[0], ["name", "y"]);
    assert.deepEqual(onFieldBlur.mock.calls[0], ["name", "y"]);
    assert.equal(formReadonly("x").type, "readonly");
    assert.equal( fieldType((name, config) => ({ name, ...config }), "x")("a").type, "x"
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
    assert.equal(audioSlider("volume").getValue({ audio }), 1);
    assert.equal( audioSelect("device", "devices").getOptions({ audio }).length, 1
    );
    assert.deepEqual(preferenceSelect("input", [{ value: "x" }]).options, [ { value: "x" } ]);
    assert.equal(preferenceSelect("input").getValue({ audio }), "x");
    preferenceSelect("input").setValue({ audio }, "y");
    assert.equal(monitorDisabled({ audio }), true);
    assert.equal(audioDriverVisible({ audio }), true);
    assert.equal(multipleAudioDriversAvailable({ audio }), true);
    assert.deepEqual( audioSelect("device", "devices").getOptions({ audio: {} }), []
    );
    assert.equal(multipleAudioDriversAvailable({ audio: {} }), false);
    assert.equal(speakerPlaying({ audio }), true);
    assert.ok(MEMORY_ACTIONS[0][5]({ freed_bytes: 1024 }));
    assert.ok(MEMORY_ACTIONS[1][5]({ freed_bytes: 2048 }));
    assert.equal(
      buildOptimizeOptions([
        { id: "a", title: "A", status: "done", optimized: false },
        { id: "b", title: "B", status: "pending", optimized: false }
      ]).length,
      2
    );
  });

  test("validates song settings and dispatches card actions", () => {
    const songs = [ { id: "a", title: "A" }, { id: "b", title: "B" } ];
    assert.equal(getSelectedSong(songs, "b").id, "b");
    assert.equal(getSelectedSong(songs).id, "a");
    assert.equal(getSelectedSong([null, songs[0]], "").id, "a");
    assert.equal(getSelectedSong([null, songs[0]], "missing"), undefined);
    assert.equal(getSelectedSong(null), undefined);
    assert.equal(normalizeText(" x "), "x");
    for (const value of [null, undefined, 7, {}, "   "])
      assert.equal(normalizeText(value), null);
    assert.equal( validateSongSettings(undefined), translateSaved("Укажите название песни.")
    );
    assert.equal( validateSongSettings({ title: "" }), translateSaved("Укажите название песни.")
    );
    assert.equal(
      validateSongSettings({ title: "x", tempo_override: 0 }),
      translateSaved("Темп должен быть больше 0 BPM.")
    );
    assert.equal(
      validateSongSettings({ title: "x", note_range_min: 90, note_range_max: 20 }),
      translateSaved("Нижняя нота диапазона не может быть выше верхней.")
    );
    for (const form of [
      { title: "x", tempo_override: 120 },
      { title: "x", tempo_override: "bad" },
      { title: "x", tempo_override: "" },
      { title: "x", tempo_override: null },
      { title: "x", note_range_min: 60, note_range_max: 60 },
      { title: "x", note_range_min: 1 },
      { title: "x", note_range_max: 0 }
    ])
      assert.equal(validateSongSettings(form), null);
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
    assert.deepEqual(
      createSongPayload(
        {
          title: " New ",
          artist: " ",
          genre: " Rock ",
          key_override: " C# ",
          tempo_override: "128.5",
          note_range_min: "60.4",
          note_range_max: "61.6",
          difficulty_override: " hard ",
          video_url: " https://example.test "
        },
        songs[0]
      ),
      {
        title: "New",
        artist: null,
        genre: "Rock",
        key_override: "C#",
        tempo_override: 128.5,
        note_range_min: 60,
        note_range_max: 62,
        difficulty_override: "hard",
        video_url: "https://example.test"
      }
    );
    assert.equal(formatSongKey(" A   minor "), "Am");
    assert.equal(formatSongKey("C   MAJOR"), "Cmaj");
    assert.equal(formatSongKey("A minor extra"), "A minor extra");
    assert.equal(formatSongKey("C major extra"), "C major extra");
    for (const value of [null, undefined, "", "   ", 0])
      assert.equal( formatSongKey(value), translateSaved("Тональность определяется")
      );
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
    const actionContracts = (actions) =>
      actions.map(([, label, variant, callback, size, options]) => ({
        label,
        variant,
        callback: typeof callback,
        size,
        options
      }));
    assert.deepEqual(actionContracts(ready), [
      {
        label: translateSaved("Прослушать записи"),
        variant: "outline",
        callback: "function",
        size: 15,
        options: undefined
      },
      {
        label: translateSaved("Настройки песни"),
        variant: "outline",
        callback: "function",
        size: 14,
        options: undefined
      },
      {
        label: translateSaved("Открыть папку"),
        variant: "outline",
        callback: "function",
        size: 14,
        options: undefined
      },
      {
        label: translateSaved("Переобработать MIDI"),
        variant: "outline",
        callback: "function",
        size: 14,
        options: undefined
      },
      {
        label: translateSaved("Удалить песню"),
        variant: "danger",
        callback: "function",
        size: 15,
        options: undefined
      }
    ]);
    ready.forEach((action) => action[3]());
    assert.deepEqual(callbacks.onOpenRecordings.mock.calls.at(-1), [songs[0]]);
    assert.deepEqual(callbacks.onOpenSettings.mock.calls.at(-1), ["a"]);
    assert.deepEqual(callbacks.onOpenFolder.mock.calls.at(-1), [songs[0]]);
    assert.deepEqual(callbacks.onReprocess.mock.calls.at(-1), [songs[0]]);
    assert.deepEqual(callbacks.onDelete.mock.calls.at(-1), [songs[0]]);
    const pending = getSongActions({
      ...callbacks,
      canManageLibrary: true,
      isReady: false,
      isWorking: true,
      song: songs[0]
    });
    assert.deepEqual(actionContracts(pending), [
      {
        label: translateSaved("Обработать песню"),
        variant: "outline",
        callback: "function",
        size: 16,
        options: { className: "library-song-card-process", disabled: true }
      },
      ...actionContracts(ready.slice(1, 3)),
      actionContracts(ready).at(-1)
    ]);
    pending.forEach((action) => action[3]());
    assert.deepEqual(callbacks.onProcess.mock.calls.at(-1), [songs[0]]);
    assert.deepEqual(
      getSongActions({ ...callbacks, canManageLibrary: false, isReady: false, song: songs[0] }),
      []
    );
    assert.equal(
      getSongActions({ ...callbacks, canManageLibrary: false, isReady: true, song: songs[0] }).length,
      1
    );
  });
});
