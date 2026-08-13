import assert from "node:assert/strict";
import { describe, test, vi } from "vitest";

import {
  clampFinite,
  formatAudioTime,
  normalizeAudioDuration,
  normalizeAudioPosition,
  normalizeAudioVolume,
  toggleAudioPlayback
} from "../src/components/audio-player-utils.js";
import {
  mergeSettings,
  prepareSettingValue,
  resolveSavedSetting
} from "../src/hooks/settings-form-utils.js";
import {
  normalizeAudioEffects,
  normalizeAudioRuntimeSettings,
  findDriverOutputDevice,
  findMatchingBrowserOutput,
  groupBrowserAudioDevices
} from "../src/pages/Karaoke/utils/audio-settings.js";
import { formatCompactKey } from "../src/pages/Karaoke/utils/display.js";
import {
  formatTime,
  midiToWesternNote
} from "../src/pages/Karaoke/utils/format.js";
import { getKaraokeStageLayout } from "../src/pages/Karaoke/utils/layout.js";
import {
  findActiveMelodyNote,
  getMelodyGuideState,
  midiToFrequency
} from "../src/pages/Karaoke/utils/melody-guide.js";
import { normalizeNoteList } from "../src/pages/Karaoke/utils/note-normalization.js";
import { getPanoramaPosition } from "../src/pages/Karaoke/utils/panorama.js";
import {
  loadKaraokePreferences,
  normalizeKaraokePreferences,
  saveKaraokePreferences
} from "../src/pages/Karaoke/utils/preferences.js";
import { shouldLoadKaraokeResult } from "../src/pages/Karaoke/utils/result.js";
import {
  getSeekTime,
  getTimelineProgress
} from "../src/pages/Karaoke/utils/timeline.js";
import {
  clampPlaybackPosition,
  createPlayerSyncCommand,
  getMicrophoneLevel,
  getSecondaryMediaPosition,
  shouldSyncMedia
} from "../src/pages/Karaoke/utils/transport.js";
import {
  adjacentNoteId,
  constrainedMoveDelta,
  deleteNotesAndTransferText,
  displayTextForNote,
  mergeSelectedNotes,
  resizeBounds
} from "../src/pages/Library/modals/song-settings/melody-editor-operations.js";
import {
  anchoredHorizontalScroll,
  anchoredVerticalScroll,
  anchoredVerticalScrollToNote,
  autoFollowScrollLeft,
  clampEditor,
  marqueeHitIds
} from "../src/pages/Library/modals/song-settings/melody-editor-geometry.js";
import {
  countReadySongs,
  filterSongs,
  getLocalVisibleSongs,
  getProcessingProgress,
  getSongCardState,
  hasActiveSongProcessing,
  isProcessingActive,
  mergeSongProcessingStatus,
  resolveVisibleSongs
} from "../src/pages/Library/utils.js";
import { getErrorMessage } from "../src/utils/errors.js";
import { readJsonStorage, writeJsonStorage } from "../src/utils/storage.js";

describe("generic normalization utilities", () => {
  test("audio helpers normalize every input class", async () => {
    assert.equal(clampFinite("2", 0, 1), 1);
    assert.equal(clampFinite("bad", 0, 1, 0.5), 0.5);
    assert.equal(normalizeAudioDuration(-1), 0);
    assert.equal(normalizeAudioDuration("12"), 12);
    assert.equal(normalizeAudioPosition("bad"), 0);
    assert.equal(normalizeAudioPosition(8, 5), 5);
    assert.equal(normalizeAudioPosition(8), 8);
    for (const value of [null, true, "", {}])
      assert.equal(normalizeAudioVolume(value), 1);
    assert.equal(normalizeAudioVolume(0.4), 0.4);
    assert.equal(formatAudioTime(65.9), "01:05");
    assert.equal(await toggleAudioPlayback(null), false);
    const playing = { paused: false, pause: vi.fn() };
    assert.equal(await toggleAudioPlayback(playing), false);
    assert.equal(playing.pause.mock.calls.length, 1);
    assert.equal(
      await toggleAudioPlayback({
        paused: true,
        play: () => Promise.resolve()
      }),
      true
    );
    assert.equal(
      await toggleAudioPlayback({ paused: true, play: () => Promise.reject() }),
      false
    );
  });

  test("settings and errors handle malformed values", () => {
    assert.equal(prepareSettingValue(" x "), "x");
    assert.equal(prepareSettingValue(2), 2);
    assert.deepEqual(mergeSettings({ a: 1 }, { b: 2 }), { a: 1, b: 2 });
    assert.deepEqual(mergeSettings([], null), {});
    assert.equal(resolveSavedSetting({ x: 0 }, "x", 5), 0);
    assert.equal(resolveSavedSetting([], "x", 5), 5);
    assert.equal(getErrorMessage(" x "), "x");
    assert.equal(getErrorMessage(new Error("bad")), "bad");
    assert.equal(getErrorMessage({ message: " object " }), "object");
    assert.equal(getErrorMessage(null, "fallback"), "fallback");
  });

  test("JSON storage is defensive", () => {
    const values = new Map();
    const storage = {
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value)
    };
    assert.equal(writeJsonStorage(" key ", { ok: true }, storage), true);
    assert.deepEqual(readJsonStorage("key", {}, storage), { ok: true });
    assert.equal(writeJsonStorage("", {}), false);
    assert.equal(writeJsonStorage("x", undefined), false);
    assert.deepEqual(readJsonStorage("", { safe: true }, storage), {
      safe: true
    });
    values.set("bad", "[");
    assert.deepEqual(readJsonStorage("bad", { safe: true }, storage), {
      safe: true
    });
    values.set("array", "[]");
    assert.deepEqual(readJsonStorage("array", { safe: true }, storage), {
      safe: true
    });
  });
});

describe("karaoke domain utilities", () => {
  test("transport and timeline clamp invalid positions", () => {
    assert.equal(clampPlaybackPosition(-2, 10), 0);
    assert.equal(clampPlaybackPosition(12, 10), 10);
    assert.equal(clampPlaybackPosition(2, 0), 2);
    assert.equal(shouldSyncMedia(1, 1.2), true);
    assert.equal(shouldSyncMedia("x", 1), false);
    assert.equal(getSecondaryMediaPosition(12, 10), 10);
    assert.equal(getSecondaryMediaPosition(-2, 0), 0);
    assert.deepEqual(createPlayerSyncCommand("play", "s", "x"), {
      type: "karaoke-player",
      action: "play",
      songId: "s",
      position: 0
    });
    assert.equal(getMicrophoneLevel({ rms_db: -30 }), 50);
    assert.equal(getMicrophoneLevel({ rms_dbfs: -100 }), 0);
    assert.equal(getMicrophoneLevel(null), 0);
    assert.equal(getTimelineProgress(5, 10), 0.5);
    assert.equal(getTimelineProgress(5, 0), 0);
    assert.equal(getSeekTime(75, 25, 100, 20), 10);
    assert.equal(getSeekTime("x", 0, 10, 10), null);
  });

  test("formatting, layout and result readiness stay deterministic", () => {
    assert.equal(formatTime(65), "1:05");
    assert.equal(formatTime(-2), "0:00");
    assert.equal(midiToWesternNote(69), "A4");
    assert.equal(midiToWesternNote(NaN), "—");
    assert.equal(formatCompactKey(" C major "), "Cmaj");
    assert.equal(formatCompactKey("A minor"), "Am");
    assert.equal(shouldLoadKaraokeResult({ id: "1", status: "done" }), true);
    assert.equal(
      shouldLoadKaraokeResult({ id: "1", status: "processing" }),
      false
    );
    assert.deepEqual(
      getKaraokeStageLayout({
        mainWidth: 1600,
        mainHeight: 900,
        stageWidth: 800,
        stageHeight: 450
      }),
      {
        navExtra: 0,
        videoWidth: 802,
        videoHeight: 452
      }
    );
  });

  test("audio device settings are normalized and matched", () => {
    assert.deepEqual(
      normalizeAudioEffects({ reverb: 2, echo: -1, delay: "0.5" }),
      {
        reverb: 1,
        echo: 0,
        delay: 0.5
      }
    );
    assert.deepEqual(
      normalizeAudioRuntimeSettings({
        volume: 2,
        audio_driver: "asio",
        asio_driver_name: "X",
        buffer_size: 128,
        monitoring_enabled: "off",
        output_device_id: 7
      }),
      {
        volume: 1,
        audioDriver: "asio",
        asioDriverName: "X",
        bufferSize: 128,
        monitoringEnabled: false,
        outputDeviceId: 7
      }
    );
    const devices = [
      { name: "Other ASIO", is_asio: true },
      { name: "Focusrite USB ASIO", is_asio: true }
    ];
    assert.equal(
      findDriverOutputDevice(devices, "Focusrite ASIO Driver"),
      devices[1]
    );
    assert.equal(findDriverOutputDevice(devices, ""), devices[0]);
    assert.equal(
      findMatchingBrowserOutput(
        [{ kind: "audiooutput", deviceId: "x", label: "Focusrite USB" }],
        devices[1]
      ).deviceId,
      "x"
    );
    assert.equal(findMatchingBrowserOutput([], {}), null);
    assert.deepEqual(
      groupBrowserAudioDevices([
        { kind: "audioinput", id: 1 },
        { kind: "audiooutput", id: 2 },
        { kind: "video", id: 3 }
      ]),
      {
        inputs: [{ kind: "audioinput", id: 1 }],
        outputs: [{ kind: "audiooutput", id: 2 }]
      }
    );
  });

  test("melody guide and note normalization reject corrupt analysis", () => {
    assert.equal(Math.round(midiToFrequency(69)), 440);
    assert.equal(midiToFrequency("x"), null);
    const notes = [{ start: 1, end: 2, midi: 69 }];
    assert.equal(findActiveMelodyNote(notes, 1.5), notes[0]);
    assert.equal(findActiveMelodyNote({}, 1), null);
    assert.equal(
      getMelodyGuideState({ notes, position: 1.5, volume: 1 }).active,
      true
    );
    assert.equal(
      getMelodyGuideState({ notes, position: 0, volume: 1 }).active,
      false
    );
    assert.deepEqual(
      normalizeNoteList(
        [
          null,
          { start: 2, end: 3, midi_note: 60, word_index: 1 },
          { start: 0, end: 1, note: "A", syllableIndex: 2 },
          { start: 0, end: 0, midi: 60 }
        ],
        (name) => (name === "A" ? 69 : NaN)
      ).map(({ start, midi }) => ({ start, midi })),
      [
        { start: 0, midi: 69 },
        { start: 2, midi: 60 }
      ]
    );
    assert.deepEqual(normalizeNoteList(null), []);
    assert.deepEqual(getPanoramaPosition(0, 1000, {}), { x: 0, y: 48 });
    assert.deepEqual(getPanoramaPosition(1, 0, {}), { x: 0, y: 48 });
  });

  test("karaoke preferences persist only normalized values", () => {
    const normalized = normalizeKaraokePreferences({
      musicVolume: 2,
      vocalVolume: -1,
      melodyVolume: "0.5",
      speed: 3,
      keyShift: 2.6,
      showLyrics: "false",
      showNotes: "yes",
      autoHideConsole: 0,
      effectPreset: " hall "
    });
    assert.deepEqual(normalized, {
      musicVolume: 1,
      vocalVolume: 0,
      melodyVolume: 0.5,
      speed: 1.5,
      keyShift: 3,
      showLyrics: false,
      showNotes: true,
      autoHideConsole: true,
      effectPreset: "hall"
    });
    const storage = {
      value: "",
      getItem() {
        return this.value;
      },
      setItem(_key, value) {
        this.value = value;
      }
    };
    assert.equal(saveKaraokePreferences(normalized, storage), true);
    assert.deepEqual(loadKaraokePreferences(storage), normalized);
    assert.deepEqual(
      loadKaraokePreferences({ getItem: () => "[" }),
      normalizeKaraokePreferences({})
    );
    assert.equal(
      saveKaraokePreferences(
        {},
        {
          setItem: () => {
            throw new Error();
          }
        }
      ),
      false
    );
  });
});

describe("library and melody editor domain utilities", () => {
  test("library lists merge live processing state", () => {
    const songs = [
      { id: "1", title: "Hello", artist: "World", status: "queued" },
      { id: "2", genre: "Rock", status: "done" }
    ];
    assert.equal(getProcessingProgress({ progress_percent: 120 }), 100);
    assert.equal(getProcessingProgress({}, { progress_percent: "x" }), 0);
    assert.equal(isProcessingActive("cancelling"), true);
    assert.equal(isProcessingActive("done"), false);
    assert.equal(hasActiveSongProcessing(songs), true);
    assert.equal(
      mergeSongProcessingStatus(songs, {
        song_id: "1",
        status: "processing",
        progress_percent: 20
      })[0].progress_percent,
      20
    );
    assert.equal(getLocalVisibleSongs(songs, new Set(["1"])).length, 1);
    assert.equal(
      resolveVisibleSongs({
        localSongs: songs,
        room: { host: false },
        roomSongs: [songs[1], null]
      }).length,
      1
    );
    assert.equal(filterSongs(songs, "world").length, 1);
    assert.equal(filterSongs(songs, "").length, 2);
    assert.equal(countReadySongs(songs), 1);
    assert.deepEqual(getSongCardState(songs[1]), {
      status: "done",
      isWorking: false,
      isReady: true
    });
  });

  test("editor geometry remains bounded", () => {
    assert.equal(clampEditor(20, 0, 10), 10);
    assert.equal(
      anchoredHorizontalScroll({
        time: 5,
        oldZoom: 10,
        newZoom: 20,
        keyboardWidth: 10,
        scrollLeft: 20,
        clientWidth: 100,
        scrollWidth: 500
      }),
      70
    );
    assert.equal(
      anchoredVerticalScroll({
        scrollTop: 50,
        clientHeight: 100,
        oldRowHeight: 10,
        newRowHeight: 20,
        rowCount: 20
      }),
      150
    );
    assert.equal(
      autoFollowScrollLeft({
        playheadX: 40,
        scrollLeft: 0,
        clientWidth: 100,
        keyboardWidth: 20,
        scrollWidth: 500
      }),
      0
    );
    assert.equal(
      autoFollowScrollLeft({
        playheadX: 100,
        scrollLeft: 0,
        clientWidth: 100,
        keyboardWidth: 20,
        scrollWidth: 500
      }),
      40
    );
    assert.equal(
      anchoredVerticalScrollToNote({
        noteMidi: 60,
        maxMidi: 70,
        oldRowHeight: 10,
        newRowHeight: 20,
        scrollTop: 50,
        clientHeight: 100,
        rowCount: 20
      }),
      155
    );
    assert.deepEqual(
      marqueeHitIds({
        notes: [{ _id: "n", start: 1, end: 2, midi_note: 60 }],
        x1: 5,
        y1: 5,
        x2: 40,
        y2: 30,
        keyboardWidth: 10,
        zoom: 10,
        rowHeight: 10,
        maxMidi: 62
      }),
      ["n"]
    );
  });

  test("note editing preserves text without duplicated syllables", () => {
    const syllables = new Map([
      [0, { text: "Бол", word_index: 1 }],
      [1, { text: "Большой", word_index: 1 }]
    ]);
    const notes = [
      {
        _id: "a",
        start: 0,
        end: 1,
        midi_note: 60,
        syllable_index: 0,
        word_index: 1
      },
      {
        _id: "b",
        start: 1,
        end: 2,
        midi_note: 62,
        syllable_index: 1,
        word_index: 1
      }
    ];
    const merged = mergeSelectedNotes(notes, ["a", "b"], syllables);
    assert.equal(merged.notes[0].editor_text, "Большой");
    assert.equal(
      displayTextForNote(notes[0], syllables, new Map([[0, "a"]])),
      "Бол"
    );
    assert.equal(displayTextForNote(notes[0], syllables, new Map()), "");
    assert.equal(
      deleteNotesAndTransferText(notes, ["a"], syllables)[0].editor_text,
      "Большой"
    );
    assert.equal(adjacentNoteId(notes, [], 1), "a");
    assert.equal(adjacentNoteId(notes, ["a"], 1), "b");
    assert.equal(constrainedMoveDelta(notes, ["a"], 5, 10), 0);
    assert.deepEqual(resizeBounds(notes, "a", 10), {
      minStart: 0,
      maxStart: 0.97,
      minEnd: 0.03,
      maxEnd: 1
    });
    assert.equal(resizeBounds(notes, "missing", 10), null);
  });
});
