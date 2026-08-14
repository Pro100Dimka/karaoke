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
  formatEta,
  formatLibraryDate,
  getLocalVisibleSongs,
  getProcessingProgress,
  getSongCardState,
  hasActiveSongProcessing,
  isProcessingActive,
  mergeSongProcessingStatus,
  resolveVisibleSongs
} from "../src/pages/Library/utils.js";
import { translateSaved } from "../src/i18n/runtime.js";
import { getErrorMessage } from "../src/utils/errors.js";
import {
  getBrowserStorage,
  readJsonStorage,
  writeJsonStorage
} from "../src/utils/storage.js";

let utilityImportId = 0;
const loadKaraokePreferencesUtility = () =>
  import(
    /* @vite-ignore */ `../src/pages/Karaoke/utils/preferences.js?contract=${utilityImportId++}`
  );

describe("generic normalization utilities", () => {
  test("audio helpers normalize every input class", async () => {
    assert.equal(clampFinite("2", 0, 1), 1);
    assert.equal(clampFinite("bad", 0, 1, 0.5), 0.5);
    assert.equal(normalizeAudioDuration(-1), 0);
    assert.equal(normalizeAudioDuration("12"), 12);
    assert.equal(normalizeAudioPosition("bad"), 0);
    assert.equal(normalizeAudioPosition(8, 5), 5);
    assert.equal(normalizeAudioPosition(8), 8);
    assert.equal(normalizeAudioPosition(8, 0), 0);
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
    assert.equal(prepareSettingValue("   "), "");
    assert.equal(prepareSettingValue(2), 2);
    assert.deepEqual(mergeSettings({ a: 1 }, { b: 2 }), { a: 1, b: 2 });
    assert.deepEqual(mergeSettings({ a: 1 }, { a: 2 }), { a: 2 });
    for (const invalid of [null, undefined, [], "bad", 7, false, () => {}]) {
      assert.deepEqual(mergeSettings(invalid, { b: 2 }), { b: 2 });
      assert.deepEqual(mergeSettings({ a: 1 }, invalid), { a: 1 });
    }
    assert.equal(resolveSavedSetting({ x: 0 }, "x", 5), 0);
    assert.equal(resolveSavedSetting({ x: false }, "x", 5), false);
    assert.equal(resolveSavedSetting({ x: undefined }, "x", 5), undefined);
    const inherited = Object.create({ x: 1 });
    assert.equal(resolveSavedSetting(inherited, "x", 5), 5);
    for (const invalid of [null, undefined, [], "bad", 7, false, () => {}])
      assert.equal(resolveSavedSetting(invalid, "x", 5), 5);
    assert.equal(getErrorMessage(" x "), "x");
    assert.equal(getErrorMessage("   ", "fallback"), "fallback");
    assert.equal(getErrorMessage(new Error(" bad ")), "bad");
    assert.equal(getErrorMessage(new Error(" "), "fallback"), "fallback");
    assert.equal(getErrorMessage({ message: " object " }), "object");
    assert.equal(getErrorMessage({ message: " " }, "fallback"), "fallback");
    assert.equal(getErrorMessage({ message: 42 }, "fallback"), "fallback");
    const callable = () => {};
    callable.message = "function-message";
    assert.equal(getErrorMessage(callable, "fallback"), "fallback");
    assert.equal(getErrorMessage(null, "fallback"), "fallback");
    assert.ok(getErrorMessage(null).length > 0);
  });

  test("library dates and estimates cover unavailable and rounded values", () => {
    assert.equal(formatLibraryDate(null), "—");
    assert.equal(formatLibraryDate("bad"), "—");
    const date = new Date("2026-01-02T12:00:00Z");
    assert.equal(formatLibraryDate(date), date.toLocaleDateString("ru-RU"));
    assert.equal(
      formatLibraryDate(date, "en-US"),
      date.toLocaleDateString("en-US")
    );
    for (const value of ["bad", NaN, Infinity, -1, 0, 0.1])
      assert.equal(formatEta(value), translateSaved("рассчитываем…"));
    assert.equal(formatEta(1), translateSaved("~{0} сек", { 0: 1 }));
    assert.equal(
      formatEta(59.6),
      translateSaved("~{0} мин {1} сек", {
        0: 1,
        1: 0
      })
    );
    assert.equal(
      formatEta(61),
      translateSaved("~{0} мин {1} сек", {
        0: 1,
        1: 1
      })
    );
  });

  test("JSON storage is defensive", () => {
    const values = new Map();
    const storage = {
      getItem: vi.fn((key) => values.get(key)),
      setItem: vi.fn((key, value) => values.set(key, value))
    };
    assert.equal(writeJsonStorage(" key ", { ok: true }, storage), true);
    assert.deepEqual(readJsonStorage("key", {}, storage), { ok: true });
    assert.deepEqual(readJsonStorage(" key ", {}, storage), { ok: true });
    storage.getItem.mockClear();
    assert.equal(writeJsonStorage("", {}), false);
    assert.equal(writeJsonStorage("x", undefined, storage), false);
    assert.equal(storage.setItem.mock.calls.length, 1);
    assert.deepEqual(readJsonStorage("", { safe: true }, storage), {
      safe: true
    });
    assert.deepEqual(readJsonStorage(null, { safe: true }, storage), {
      safe: true
    });
    assert.equal(storage.getItem.mock.calls.length, 0);
    assert.deepEqual(readJsonStorage("missing", { safe: true }, storage), {
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
    values.set("null", "null");
    assert.deepEqual(readJsonStorage("null", { safe: true }, storage), {
      safe: true
    });
    values.set("primitive", "1");
    assert.deepEqual(readJsonStorage("primitive", { safe: true }, storage), {
      safe: true
    });
    assert.equal(writeJsonStorage("x", {}, null), false);
    assert.equal(writeJsonStorage("x", {}, {}), false);
    assert.equal(writeJsonStorage(null, {}, storage), false);
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage"
    );
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("blocked");
      }
    });
    assert.equal(getBrowserStorage(), null);
    if (descriptor)
      Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
    assert.equal(writeJsonStorage("x", 1n, { setItem: () => {} }), false);
    assert.equal(
      writeJsonStorage(
        "x",
        {},
        {
          setItem: () => {
            throw new Error("full");
          }
        }
      ),
      false
    );
    assert.deepEqual(
      readJsonStorage(
        "x",
        { safe: true },
        {
          getItem: () => {
            throw new Error("blocked");
          }
        }
      ),
      { safe: true }
    );
  });
});

describe("karaoke domain utilities", () => {
  test("transport and timeline clamp invalid positions", () => {
    assert.equal(clampPlaybackPosition(-2, 10), 0);
    assert.equal(clampPlaybackPosition("bad", 10), 0);
    assert.equal(clampPlaybackPosition(12, 10), 10);
    assert.equal(clampPlaybackPosition(2, 0), 2);
    assert.equal(shouldSyncMedia(1, 1.2), true);
    assert.equal(shouldSyncMedia(1, 1.04), false);
    assert.equal(shouldSyncMedia(1, 1.09), true);
    assert.equal(shouldSyncMedia(1, 1.01, -1), true);
    assert.equal(shouldSyncMedia(1, "bad"), false);
    assert.equal(shouldSyncMedia(1, 1, 0), false);
    assert.equal(shouldSyncMedia("x", 1), false);
    assert.equal(getSecondaryMediaPosition(12, 10), 10);
    assert.equal(getSecondaryMediaPosition(8, 0), 8);
    assert.equal(getSecondaryMediaPosition(8, -1), 8);
    assert.equal(getSecondaryMediaPosition(8, NaN), 8);
    assert.equal(getSecondaryMediaPosition(-2, 0), 0);
    assert.deepEqual(createPlayerSyncCommand("play", "s", "x"), {
      type: "karaoke-player",
      action: "play",
      songId: "s",
      position: 0
    });
    assert.equal(createPlayerSyncCommand("seek", "s", 5).position, 5);
    assert.equal(getMicrophoneLevel({ rms_db: -30 }), 50);
    assert.equal(getMicrophoneLevel({ rms_dbfs: -100 }), 0);
    assert.equal(getMicrophoneLevel(null), 0);
    assert.equal(getTimelineProgress(5, 10), 0.5);
    assert.equal(getTimelineProgress(5, 0), 0);
    assert.equal(getTimelineProgress("bad", 10), 0);
    assert.equal(getSeekTime(75, 25, 100, 20), 10);
    assert.equal(getSeekTime("x", 0, 10, 10), null);
    assert.equal(getSeekTime(5, 0, 0, 10), null);
    assert.equal(getSeekTime(5, 0, 10, 0), null);
    assert.equal(getSecondaryMediaPosition("bad", 10), 0);
  });

  test("formatting, layout and result readiness stay deterministic", () => {
    assert.equal(formatTime(65), "1:05");
    assert.equal(formatTime(-2), "0:00");
    assert.equal(formatTime(NaN), "0:00");
    assert.equal(midiToWesternNote(69), "A4");
    assert.equal(midiToWesternNote(NaN), "—");
    assert.deepEqual(
      Array.from({ length: 12 }, (_, index) => midiToWesternNote(60 + index)),
      [
        "C4",
        "C♯4",
        "D4",
        "D♯4",
        "E4",
        "F4",
        "F♯4",
        "G4",
        "G♯4",
        "A4",
        "A♯4",
        "B4"
      ]
    );
    assert.equal(midiToWesternNote(-1), "B-2");
    assert.equal(formatCompactKey(" C major "), "Cmaj");
    assert.equal(formatCompactKey("Cmajor"), "Cmaj");
    assert.equal(formatCompactKey("C   major"), "Cmaj");
    assert.equal(formatCompactKey("A minor"), "Am");
    assert.equal(formatCompactKey("Aminor"), "Am");
    assert.equal(formatCompactKey("Am major"), "Amaj");
    assert.equal(formatCompactKey("Am major chord"), "Ammajchord");
    assert.equal(formatCompactKey(null), "—");
    assert.equal(shouldLoadKaraokeResult({ id: "1", status: "done" }), true);
    assert.equal(
      shouldLoadKaraokeResult({ id: "1", status: "processing" }),
      false
    );
    assert.equal(shouldLoadKaraokeResult(null), false);
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
    assert.deepEqual(
      getKaraokeStageLayout({
        mainWidth: "bad",
        mainHeight: null,
        stageWidth: undefined,
        stageHeight: NaN,
        currentNavExtra: -1
      }),
      { navExtra: 0, videoWidth: 2, videoHeight: 2 }
    );
    assert.deepEqual(
      getKaraokeStageLayout({
        mainWidth: 1000,
        mainHeight: 800,
        stageWidth: 100,
        stageHeight: 500,
        currentNavExtra: 50
      }),
      { navExtra: 287.5, videoWidth: 891, videoHeight: 502 }
    );
    assert.deepEqual(
      getKaraokeStageLayout({
        mainWidth: 1000,
        mainHeight: 500,
        stageWidth: 1000,
        stageHeight: 100,
        currentNavExtra: 100
      }),
      { navExtra: 37.5, videoWidth: 1002, videoHeight: 565 }
    );
    assert.equal(
      normalizeAudioRuntimeSettings({ monitoring_enabled: "yes" })
        .monitoringEnabled,
      true
    );
    assert.equal(
      normalizeAudioRuntimeSettings({ monitoring_enabled: "unknown" })
        .monitoringEnabled,
      true
    );
    assert.equal(
      normalizeAudioRuntimeSettings({
        volume: "bad",
        audio_driver: 1,
        asio_driver_name: null,
        buffer_size: -1,
        monitoring_enabled: 0,
        output_device_id: {}
      }).audioDriver,
      "auto"
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
    assert.deepEqual(normalizeAudioEffects(null), {
      reverb: 0,
      echo: 0,
      delay: 0
    });
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
    assert.deepEqual(normalizeAudioRuntimeSettings(null), {
      volume: 0,
      audioDriver: "auto",
      asioDriverName: "",
      bufferSize: 64,
      monitoringEnabled: false,
      outputDeviceId: ""
    });
    for (const value of ["false", "0", "off", "no", "", "  false  "])
      assert.equal(
        normalizeAudioRuntimeSettings({ monitoring_enabled: value })
          .monitoringEnabled,
        false
      );
    for (const value of ["true", "1", "on", "yes", "  true  "])
      assert.equal(
        normalizeAudioRuntimeSettings({ monitoring_enabled: value })
          .monitoringEnabled,
        true
      );
    for (const [value, expected] of [
      [0, 64],
      [-1, 64],
      [1.5, 64],
      ["128", 128]
    ])
      assert.equal(
        normalizeAudioRuntimeSettings({ buffer_size: value }).bufferSize,
        expected
      );
    assert.deepEqual(
      normalizeAudioRuntimeSettings({
        audio_driver: "",
        asio_driver_name: 42,
        output_device_id: true
      }),
      {
        volume: 0,
        audioDriver: "auto",
        asioDriverName: "",
        bufferSize: 64,
        monitoringEnabled: false,
        outputDeviceId: ""
      }
    );
    assert.equal(
      normalizeAudioRuntimeSettings({ output_device_id: "speaker" })
        .outputDeviceId,
      "speaker"
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
    const tokenMatch = { name: "Focusrite USB", is_asio: false };
    const asioOnly = { name: "Other", is_asio: true };
    assert.equal(
      findDriverOutputDevice([asioOnly, tokenMatch], "Focusrite Driver"),
      tokenMatch
    );
    const asioMatch = { name: "Focusrite", is_asio: true };
    const twoTokenMatch = { name: "Focusrite USB", is_asio: false };
    assert.equal(
      findDriverOutputDevice(
        [twoTokenMatch, asioMatch],
        "Focusrite ASIO Driver"
      ),
      asioMatch
    );
    assert.equal(
      findDriverOutputDevice(
        [{ name: "was here!", is_asio: false }, asioMatch],
        "Focusrite ASIO"
      ),
      asioMatch
    );
    assert.equal(
      findDriverOutputDevice([{ name: "AB", is_asio: false }], "AB"),
      null
    );
    assert.equal(findDriverOutputDevice([null], "Focusrite"), null);
    assert.equal(
      findDriverOutputDevice(
        [{ name: "Stryker was here", is_asio: false }],
        null
      ),
      null
    );
    assert.equal(
      findDriverOutputDevice([{ id: 1, is_asio: false }], "Stryker was here"),
      null
    );
    assert.equal(findDriverOutputDevice(null, "anything"), null);
    assert.equal(
      findDriverOutputDevice([{ name: null, is_asio: false }], "anything"),
      null
    );
    assert.equal(
      findMatchingBrowserOutput(
        [{ kind: "audiooutput", deviceId: "x", label: "Focusrite USB" }],
        devices[1]
      ).deviceId,
      "x"
    );
    assert.equal(findMatchingBrowserOutput([], {}), null);
    assert.equal(
      findMatchingBrowserOutput(
        [{ kind: "audiooutput", deviceId: "x", label: "Focusrite" }],
        null
      ),
      null
    );
    assert.equal(
      findMatchingBrowserOutput(
        [{ kind: "audiooutput", deviceId: "x", label: "Stryker was here!" }],
        null
      ),
      null
    );
    assert.equal(
      findMatchingBrowserOutput(
        [{ kind: "audiooutput", deviceId: "x", label: "Focusrite" }],
        { name: " " }
      ),
      null
    );
    assert.equal(findMatchingBrowserOutput(null, devices[1]), null);
    assert.equal(
      findMatchingBrowserOutput(
        [{ kind: "audioinput", deviceId: "x", label: "Focusrite" }],
        devices[1]
      ),
      null
    );
    assert.equal(
      findMatchingBrowserOutput(
        [{ kind: "audiooutput", deviceId: "x", label: "Completely Different" }],
        { name: "Focusrite USB" }
      ),
      null
    );
    assert.equal(
      findMatchingBrowserOutput(
        [{ kind: "audiooutput", deviceId: "x", label: "  Focusrite USB  " }],
        { name: "  Focusrite USB  " }
      ).deviceId,
      "x"
    );
    assert.equal(
      findMatchingBrowserOutput(
        [{ kind: "audiooutput", deviceId: "x", label: "Focusrite USB" }],
        { name: "  Focusrite  " }
      ).deviceId,
      "x"
    );
    assert.equal(
      findMatchingBrowserOutput(
        [{ kind: "audiooutput", deviceId: "x", label: "  Focusrite  " }],
        { name: "Focusrite USB" }
      ).deviceId,
      "x"
    );
    assert.equal(
      findMatchingBrowserOutput(
        [{ kind: "audiooutput", deviceId: "x", label: null }],
        { name: "Stryker was here!" }
      ),
      null
    );
    assert.equal(findMatchingBrowserOutput([null], devices[1]), null);
    assert.equal(
      findMatchingBrowserOutput(
        [
          { kind: "audiooutput", deviceId: "", label: "Focusrite" },
          { kind: "audiooutput", deviceId: "x", label: null }
        ],
        devices[1]
      ),
      null
    );
    assert.equal(
      findMatchingBrowserOutput(
        [
          {
            kind: "audiooutput",
            deviceId: "x",
            label: "Focusrite USB ASIO Pro"
          }
        ],
        { name: "Focusrite USB" }
      ).deviceId,
      "x"
    );
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
    assert.deepEqual(groupBrowserAudioDevices(null), {
      inputs: [],
      outputs: []
    });
    assert.deepEqual(groupBrowserAudioDevices([null]), {
      inputs: [],
      outputs: []
    });
  });

  test("melody guide and note normalization reject corrupt analysis", () => {
    assert.equal(Math.round(midiToFrequency(69)), 440);
    assert.equal(Math.round(midiToFrequency(81)), 880);
    assert.equal(Math.round(midiToFrequency(57)), 220);
    assert.equal(midiToFrequency("x"), null);
    const notes = [{ start: 1, end: 2, midi: 69 }];
    assert.equal(findActiveMelodyNote(notes, 1.5), notes[0]);
    assert.equal(findActiveMelodyNote(notes, 1), notes[0]);
    assert.equal(findActiveMelodyNote(notes, 2), null);
    assert.equal(findActiveMelodyNote([null], 1), null);
    assert.equal(findActiveMelodyNote([{ start: 1, end: "bad" }], 1), null);
    assert.equal(findActiveMelodyNote([{ start: "bad", end: 2 }], 1), null);
    assert.equal(findActiveMelodyNote({}, 1), null);
    assert.equal(
      getMelodyGuideState({ notes, position: 1.5, volume: 1 }).active,
      true
    );
    const shiftedGuide = getMelodyGuideState({
      notes,
      position: 1.5,
      keyShift: 12,
      volume: 0.5
    });
    assert.equal(Math.round(shiftedGuide.frequency), 880);
    assert.equal(shiftedGuide.gain, 0.3 * 0.5 ** 1.65);
    assert.equal(
      getMelodyGuideState({ notes, position: 0, volume: 1 }).active,
      false
    );
    assert.equal(
      getMelodyGuideState({ notes, position: 1.5, volume: "bad" }).active,
      false
    );
    assert.equal(
      getMelodyGuideState({
        notes: [{ start: 0, end: 1, midi: "bad" }],
        position: 0.5,
        volume: 1
      }).active,
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
    const callableNote = () => {};
    Object.assign(callableNote, { start: 0, end: 1, midi: 60 });
    assert.deepEqual(normalizeNoteList([callableNote]), []);
    assert.deepEqual(
      normalizeNoteList([
        { start: 0, end: 1, midi: 0 },
        { start: 1, end: 2, midi: 127 },
        { start: -1, end: 1, midi: 60 },
        { start: 2, end: 1, midi: 60 },
        { start: 0, end: "bad", midi: 60 },
        { start: 0, end: 1, midi: -1 },
        { start: 0, end: 1, midi: 128 },
        { start: undefined, end: 1, midi: 60 }
      ]).map(({ midi }) => midi),
      [0, 127]
    );
    assert.deepEqual(normalizeNoteList([{ start: 0, end: 1, note: "A" }]), []);
    assert.deepEqual(normalizeNoteList(null), []);
    assert.deepEqual(
      normalizeNoteList([{ start: 0, end: 1, note: "unknown" }]),
      []
    );
    assert.deepEqual(
      normalizeNoteList([
        { start: 0, end: 2, midi: 61, wordIndex: 2, syllableIndex: 3 },
        { start: 0, end: 1, midi: 62 },
        { start: 0, end: 1, midi: 60 }
      ]).map(({ midi, wordIndex, syllableIndex }) => ({
        midi,
        wordIndex,
        syllableIndex
      })),
      [
        { midi: 60, wordIndex: null, syllableIndex: null },
        { midi: 62, wordIndex: null, syllableIndex: null },
        { midi: 61, wordIndex: 2, syllableIndex: 3 }
      ]
    );
    assert.deepEqual(getPanoramaPosition(0, 1000, {}), { x: 0, y: 48 });
    assert.deepEqual(getPanoramaPosition(1, 0, {}), { x: 0, y: 48 });
    assert.deepEqual(getPanoramaPosition(1, -1, {}), { x: 0, y: 48 });
    assert.deepEqual(getPanoramaPosition(1, Infinity, {}), { x: 0, y: 48 });
    assert.deepEqual(getPanoramaPosition("bad", 1000, null), { x: 0, y: 48 });
    assert.deepEqual(getPanoramaPosition(250, 1000, {}), { x: 16, y: 49.2 });
    assert.deepEqual(getPanoramaPosition(1250, 1000, {}), {
      x: 16,
      y: 49.2
    });
    assert.deepEqual(getPanoramaPosition(-250, 1000, {}), {
      x: -16,
      y: 46.8
    });
    assert.deepEqual(
      getPanoramaPosition(250, 1000, {
        xPhaseA: 0.2,
        xPhaseB: 0.4,
        xPhaseC: 0.6,
        yPhaseA: 0.8,
        yPhaseB: 1
      }),
      { x: 1.979360053568512, y: 44.195288348954584 }
    );
    assert.deepEqual(
      getPanoramaPosition(137, 1000, {
        xPhaseA: 0.2,
        xPhaseB: 0.4,
        xPhaseC: 0.6,
        yPhaseA: 0.8,
        yPhaseB: 1
      }),
      { x: 1.0037174421043353, y: 45.66700030928629 }
    );
  });

  test("karaoke preferences persist only normalized values", async () => {
    const {
      KARAOKE_PREFERENCES_KEY,
      loadKaraokePreferences,
      normalizeKaraokePreferences,
      saveKaraokePreferences
    } = await loadKaraokePreferencesUtility();
    assert.equal(KARAOKE_PREFERENCES_KEY, "karaoke-player-preferences");
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
    assert.deepEqual(normalizeKaraokePreferences(null), {
      musicVolume: 1,
      vocalVolume: 1,
      melodyVolume: 0,
      speed: 1,
      keyShift: 0,
      showLyrics: true,
      showNotes: true,
      autoHideConsole: true,
      effectPreset: "studio"
    });
    assert.equal(
      normalizeKaraokePreferences({ showLyrics: "unknown" }).showLyrics,
      true
    );
    for (const value of ["false", "0", "no", "off", "", "  false  "])
      assert.equal(
        normalizeKaraokePreferences({ showLyrics: value }).showLyrics,
        false
      );
    assert.equal(normalizeKaraokePreferences([]).effectPreset, "studio");
    const storage = {
      value: "",
      getItem(key) {
        assert.equal(key, "karaoke-player-preferences");
        return this.value;
      },
      setItem(key, value) {
        assert.equal(key, "karaoke-player-preferences");
        this.value = value;
      }
    };
    assert.equal(saveKaraokePreferences(normalized, storage), true);
    assert.deepEqual(loadKaraokePreferences(storage), normalized);
    assert.deepEqual(
      loadKaraokePreferences({ getItem: () => "" }),
      normalizeKaraokePreferences({})
    );
    assert.deepEqual(
      loadKaraokePreferences({ getItem: () => "[" }),
      normalizeKaraokePreferences({})
    );
    assert.deepEqual(
      loadKaraokePreferences(null),
      normalizeKaraokePreferences({})
    );
    assert.equal(saveKaraokePreferences({}, null), false);
    const callablePreferences = () => {};
    callablePreferences.effectPreset = "hall";
    assert.equal(
      normalizeKaraokePreferences(callablePreferences).effectPreset,
      "studio"
    );
    assert.equal(
      normalizeKaraokePreferences({ effectPreset: "   " }).effectPreset,
      "studio"
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
    assert.equal(getProcessingProgress(null, { progress_percent: 25 }), 25);
    assert.equal(getProcessingProgress(null, null), 0);
    for (const status of ["processing", "queued", "cancelling"])
      assert.equal(isProcessingActive(status), true);
    for (const status of ["done", "pending", "", null])
      assert.equal(isProcessingActive(status), false);
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
    assert.equal(hasActiveSongProcessing([{ status: null }]), false);
    assert.equal(hasActiveSongProcessing([null, { status: "done" }]), false);
    assert.equal(hasActiveSongProcessing(null), false);
    assert.deepEqual(mergeSongProcessingStatus(null, null), []);
    assert.equal(mergeSongProcessingStatus("bad", { song_id: "1" }), "bad");
    assert.equal(mergeSongProcessingStatus(songs, null), songs);
    assert.equal(mergeSongProcessingStatus(songs, {}), songs);
    const mixedSongs = [null, songs[1], songs[0]];
    assert.deepEqual(
      mergeSongProcessingStatus(mixedSongs, {
        song_id: "1",
        status: "processing"
      }),
      [
        null,
        songs[1],
        {
          ...songs[0],
          status: "processing",
          progress_step: undefined,
          progress_percent: undefined,
          error_message: undefined
        }
      ]
    );
    assert.deepEqual(
      mergeSongProcessingStatus(
        [
          {
            id: "1",
            status: "old",
            progress_step: "step",
            progress_percent: 5,
            error_message: "error"
          }
        ],
        { song_id: "1" }
      )[0],
      {
        id: "1",
        status: "old",
        progress_step: "step",
        progress_percent: 5,
        error_message: "error"
      }
    );
    assert.equal(getLocalVisibleSongs(songs, null).length, 2);
    assert.deepEqual(
      getLocalVisibleSongs([null, "bad", songs[0], songs[1]], new Set(["2"])),
      [songs[0]]
    );
    assert.deepEqual(getLocalVisibleSongs(null, null), []);
    assert.deepEqual(
      resolveVisibleSongs({ localSongs: null, room: null, roomSongs: null }),
      []
    );
    assert.equal(
      resolveVisibleSongs({
        localSongs: songs,
        room: { host: true },
        roomSongs: []
      }),
      songs
    );
    assert.deepEqual(
      resolveVisibleSongs({
        localSongs: songs,
        room: { host: false },
        roomSongs: [null, "bad", songs[1]]
      }),
      [songs[1]]
    );
    assert.equal(
      resolveVisibleSongs({
        localSongs: songs,
        room: { host: false },
        roomSongs: null
      }),
      songs
    );
    assert.deepEqual(filterSongs(null, null), []);
    assert.equal(filterSongs(songs, ""), songs);
    assert.equal(filterSongs(songs, "   "), songs);
    assert.equal(filterSongs(songs, "  WORLD  ")[0], songs[0]);
    assert.equal(filterSongs(songs, "rock")[0], songs[1]);
    assert.deepEqual(filterSongs([null, {}, songs[0]], "hello"), [songs[0]]);
    const joinedSongs = [
      { title: "alpha", artist: "beta" },
      { title: "alpha", artist: " ", genre: "beta" },
      { title: {} }
    ];
    assert.deepEqual(
      filterSongs(joinedSongs, "alpha beta"),
      joinedSongs.slice(0, 2)
    );
    assert.deepEqual(
      filterSongs([{ title: "alpha", artist: " " }], "alpha  "),
      [{ title: "alpha", artist: " " }]
    );
    assert.deepEqual(filterSongs([joinedSongs[2]], "object"), []);
    assert.deepEqual(filterSongs(songs, 7), songs);
    assert.equal(countReadySongs(null), 0);
    assert.equal(countReadySongs([null, { status: "pending" }, songs[1]]), 1);
    assert.equal(getSongCardState(null).status, "pending");
    for (const [status, expected] of [
      ["processing", { isWorking: true, isReady: false }],
      ["queued", { isWorking: true, isReady: false }],
      ["cancelling", { isWorking: true, isReady: false }],
      ["done", { isWorking: false, isReady: true }],
      ["pending", { isWorking: false, isReady: false }]
    ])
      assert.deepEqual(getSongCardState({ status }), { status, ...expected });
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
    assert.deepEqual(
      marqueeHitIds({
        notes: null,
        x1: 0,
        y1: 0,
        x2: 1,
        y2: 1,
        keyboardWidth: 0,
        zoom: 1,
        rowHeight: 10,
        maxMidi: 0
      }),
      []
    );
    assert.deepEqual(
      marqueeHitIds({
        notes: [{ _id: "zero", start: 0, end: 0, midi_note: 0 }],
        x1: 0,
        y1: 0,
        x2: 20,
        y2: 20,
        keyboardWidth: 0,
        zoom: 1,
        rowHeight: 10,
        maxMidi: 0
      }),
      ["zero"]
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
        word_index: 1,
        syllable_indices: [2, 0, 1]
      },
      {
        _id: "b",
        start: 1,
        end: 2,
        midi_note: 62,
        syllable_index: 1,
        word_index: 1
      },
      {
        _id: "c",
        start: 3,
        end: 4,
        midi_note: 55,
        syllable_index: 3,
        word_index: 2
      }
    ];
    const merged = mergeSelectedNotes(notes, ["a", "b"], syllables);
    assert.deepEqual(merged.notes[0].syllable_indices, [0, 1, 2]);
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

  test("note editing covers text-transfer and boundary edge cases", () => {
    const syllables = new Map([
      [0, { text: "hel", word_index: 1 }],
      [1, { text: "ello", word_index: 1 }],
      [2, { text: "world", word_index: 2 }]
    ]);
    const notes = [
      {
        _id: "a",
        start: 0,
        end: 1,
        midi_note: 60,
        syllable_index: 0
      },
      {
        _id: "b",
        start: 1,
        end: 2,
        midi_note: 61,
        syllable_index: 1,
        editor_text: "ello"
      },
      {
        _id: "c",
        start: 2,
        end: 3,
        midi_note: 62,
        syllable_index: 2
      }
    ];
    assert.equal(mergeSelectedNotes(notes, [], syllables).selectedId, null);
    assert.equal(
      mergeSelectedNotes(notes, ["a", "b"], syllables).notes.find(
        ({ _id }) => _id === "a"
      ).editor_text,
      "hello"
    );
    assert.equal(
      mergeSelectedNotes(
        [
          { ...notes[0], editor_text: "hello", word_index: 1 },
          { ...notes[1], editor_text: "lo", word_index: 1 }
        ],
        ["a", "b"],
        syllables
      ).notes[0].editor_text,
      "hello"
    );
    assert.equal(
      mergeSelectedNotes(notes, ["a", "c"], syllables).notes.find(
        ({ _id }) => _id === "a"
      ).editor_text,
      "hel world"
    );
    assert.equal(
      mergeSelectedNotes(
        [
          { ...notes[0], editor_text: "ab", word_index: 1 },
          { ...notes[1], editor_text: "cd", word_index: 1 }
        ],
        ["a", "b"],
        syllables
      ).notes[0].editor_text,
      "abcd"
    );
    assert.equal(
      mergeSelectedNotes(
        [
          { ...notes[0], editor_text: "left", word_index: 1 },
          {
            ...notes[1],
            editor_text: "",
            syllable_index: 99,
            word_index: 1
          }
        ],
        ["a", "b"],
        syllables
      ).notes[0].editor_text,
      "left"
    );
    assert.equal(
      displayTextForNote(
        { ...notes[0], editor_text: "edited" },
        syllables,
        new Map()
      ),
      "edited"
    );
    const withoutText = [{ ...notes[0], editor_text: "", syllable_index: NaN }];
    assert.deepEqual(
      deleteNotesAndTransferText([...withoutText, notes[1]], ["a"], syllables),
      [notes[1]]
    );
    assert.equal(
      deleteNotesAndTransferText(
        [notes[1], notes[0], notes[2]],
        ["b", "a"],
        syllables
      ).length,
      1
    );
    assert.equal(adjacentNoteId([], [], 1), null);
    assert.equal(adjacentNoteId(notes, [], -1), "c");
    assert.equal(adjacentNoteId(notes, ["b"], -1), "a");
    assert.equal(adjacentNoteId(notes, ["c"], -1), "b");
    assert.equal(
      adjacentNoteId(
        [
          { _id: "high", start: 0, end: 1, midi_note: 62 },
          { _id: "low", start: 0, end: 1, midi_note: 60 }
        ],
        [],
        1
      ),
      "low"
    );
    assert.equal(constrainedMoveDelta(notes, [], 1, 10), 0);
    assert.equal(constrainedMoveDelta(notes, ["b"], -5, 10), 0);
    assert.equal(resizeBounds(notes, "b", 10).minStart, 1);

    assert.equal(
      displayTextForNote(
        { _id: "missing", syllable_index: 42 },
        new Map(),
        new Map([[42, "missing"]])
      ),
      ""
    );
    assert.equal(
      mergeSelectedNotes(
        [
          {
            _id: "empty-a",
            start: 0,
            end: 1,
            midi_note: 60,
            syllable_index: NaN
          },
          {
            _id: "empty-b",
            start: 0,
            end: 2,
            midi_note: 62,
            syllable_index: NaN
          }
        ],
        ["empty-a", "empty-b"],
        new Map()
      ).notes[0].editor_text,
      ""
    );
    assert.equal(
      mergeSelectedNotes(
        [
          { _id: "low", start: 0, end: 2, midi_note: 50 },
          { _id: "a", start: 0, end: 1, midi_note: 60 },
          { _id: "b", start: 1, end: 2, midi_note: 62 }
        ],
        ["a", "b"],
        new Map()
      ).notes[0]._id,
      "low"
    );
    assert.equal(deleteNotesAndTransferText(notes, [], syllables).length, 3);
    assert.deepEqual(
      deleteNotesAndTransferText(notes, ["a", "b", "c"], syllables),
      []
    );
    const transferredRight = deleteNotesAndTransferText(
      [
        { _id: "right", start: 2, end: 3, midi_note: 62 },
        {
          _id: "gone",
          start: 1,
          end: 2,
          midi_note: 61,
          editor_text: "middle"
        },
        { _id: "left", start: 0, end: 1, midi_note: 60 }
      ],
      ["gone"],
      new Map()
    );
    assert.equal(transferredRight[0].editor_text, "middle");
    assert.equal(
      deleteNotesAndTransferText(
        [
          { _id: "same-high", start: 0, end: 1, midi_note: 62 },
          { _id: "same-low", start: 0, end: 1, midi_note: 60 },
          {
            _id: "after",
            start: 2,
            end: 3,
            midi_note: 64,
            editor_text: "after"
          }
        ],
        ["after"],
        new Map()
      )[0]._id,
      "same-low"
    );
  });
});
