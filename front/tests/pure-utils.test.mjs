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
} from "../src/pages/Settings/hooks/settings-form-utils.js";
import { translateSaved } from "../src/i18n/runtime.js";
import {
  findDriverOutputDevice,
  findMatchingBrowserOutput,
  groupBrowserAudioDevices,
  normalizeAudioEffects,
  normalizeAudioRuntimeSettings
} from "../src/pages/Karaoke/utils/audio-settings.js";
import { formatCompactKey } from "../src/pages/Karaoke/utils/display.js";
import { formatTime, midiToWesternNote } from "../src/pages/Karaoke/utils/format.js";
import { getKaraokeStageLayout } from "../src/pages/Karaoke/utils/layout.js";
import {
  findActiveMelodyNote,
  getMelodyGuideState,
  midiToFrequency
} from "../src/pages/Karaoke/utils/melody-guide.js";
import { normalizeNoteList } from "../src/pages/Karaoke/utils/note-normalization.js";
import { getPanoramaPosition } from "../src/pages/Karaoke/utils/panorama.js";
import { shouldLoadKaraokeResult } from "../src/pages/Karaoke/utils/result.js";
import { getSeekTime, getTimelineProgress } from "../src/pages/Karaoke/utils/timeline.js";
import {
  clampPlaybackPosition,
  createPlayerSyncCommand,
  getMicrophoneLevel,
  getSecondaryMediaPosition,
  shouldSyncMedia
} from "../src/pages/Karaoke/utils/transport.js";
import {
  anchoredHorizontalScroll,
  anchoredVerticalScroll,
  anchoredVerticalScrollToNote,
  autoFollowScrollLeft,
  clampEditor,
  marqueeHitIds
} from "../src/pages/Library/modals/song-settings/melody-editor-geometry.js";
import {
  adjacentNoteId,
  constrainedMoveDelta,
  deleteNotesAndTransferText,
  displayTextForNote,
  mergeSelectedNotes,
  resizeBounds
} from "../src/pages/Library/modals/song-settings/melody-editor-operations.js";
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
import { getErrorMessage } from "../src/utils/errors.js";
import { getBrowserStorage, readJsonStorage, writeJsonStorage } from "../src/utils/storage.js";
import { equal, deepEqual } from "./helpers/assertions.mjs";
const loadKaraokePreferencesUtility = async () => {
  vi.resetModules();
  return import("../src/pages/Karaoke/utils/preferences.js");
};
describe("generic normalization utilities", () => {
  test("audio helpers normalize every input class", async () => {
    equal([clampFinite("2", 0, 1), 1], [clampFinite("bad", 0, 1, 0.5), 0.5], [normalizeAudioDuration(-1), 0], [normalizeAudioDuration("12"), 12], [normalizeAudioPosition("bad"), 0], [normalizeAudioPosition(8, 5), 5], [normalizeAudioPosition(8), 8], [normalizeAudioPosition(8, 0), 0]);
    for (const value of [null, true, "", {}]) assert.equal(normalizeAudioVolume(value), 1);
    equal([normalizeAudioVolume(0.4), 0.4], [formatAudioTime(65.9), "01:05"], [await toggleAudioPlayback(null), false]);
    const playing = { paused: false, pause: vi.fn() };
    equal([await toggleAudioPlayback(playing), false], [playing.pause.mock.calls.length, 1], [await toggleAudioPlayback({ paused: true, play: () => Promise.resolve() }), true], [await toggleAudioPlayback({ paused: true, play: () => Promise.reject() }), false]);
  });
  test("settings and errors handle malformed values", () => {
    equal([prepareSettingValue(" x "), "x"], [prepareSettingValue("   "), ""], [prepareSettingValue(2), 2]);
    deepEqual([mergeSettings({ a: 1 }, { b: 2 }), { a: 1, b: 2 }], [mergeSettings({ a: 1 }, { a: 2 }), { a: 2 }]);
    for (const invalid of [null, undefined, [], "bad", 7, false, () => {}]) {
      deepEqual([mergeSettings(invalid, { b: 2 }), { b: 2 }], [mergeSettings({ a: 1 }, invalid), { a: 1 }]);
    }
    equal([resolveSavedSetting({ x: 0 }, "x", 5), 0], [resolveSavedSetting({ x: false }, "x", 5), false], [resolveSavedSetting({ x: undefined }, "x", 5), undefined]);
    const inherited = Object.create({ x: 1 });
    equal([resolveSavedSetting(inherited, "x", 5), 5]);
    for (const invalid of [null, undefined, [], "bad", 7, false, () => {}])
      equal([resolveSavedSetting(invalid, "x", 5), 5]);
    equal([getErrorMessage(" x "), "x"], [getErrorMessage("   ", "fallback"), "fallback"], [getErrorMessage(new Error(" bad ")), "bad"], [getErrorMessage(new Error(" "), "fallback"), "fallback"], [getErrorMessage({ message: " object " }), "object"], [getErrorMessage({ message: " " }, "fallback"), "fallback"], [getErrorMessage({ message: 42 }, "fallback"), "fallback"]);
    const callable = () => {};
    callable.message = "function-message";
    equal([getErrorMessage(callable, "fallback"), "fallback"], [getErrorMessage(null, "fallback"), "fallback"]);
    assert.ok(getErrorMessage(null).length > 0);
  });
  test("library dates and estimates cover unavailable and rounded values", () => {
    equal([formatLibraryDate(null), "—"], [formatLibraryDate("bad"), "—"]);
    const date = new Date("2026-01-02T12:00:00Z");
    equal([formatLibraryDate(date), date.toLocaleDateString("ru-RU")], [formatLibraryDate(date, "en-US"), date.toLocaleDateString("en-US")]);
    for (const value of ["bad", NaN, Infinity, -1, 0, 0.1])
      equal([formatEta(value), translateSaved("рассчитываем…")]);
    equal([formatEta(1), translateSaved("~{0} сек", { 0: 1 })], [formatEta(59.6), translateSaved("~{0} мин {1} сек", { 0: 1, 1: 0 })], [formatEta(61), translateSaved("~{0} мин {1} сек", { 0: 1, 1: 1 })]);
  });
  test("JSON storage is defensive", () => {
    const values = new Map();
    const storage = {
      getItem: vi.fn((key) => values.get(key)),
      setItem: vi.fn((key, value) => values.set(key, value))
    };
    equal([writeJsonStorage(" key ", { ok: true }, storage), true]);
    deepEqual([readJsonStorage("key", {}, storage), { ok: true }], [readJsonStorage(" key ", {}, storage), { ok: true }]);
    storage.getItem.mockClear();
    equal([writeJsonStorage("", {}), false], [writeJsonStorage("x", undefined, storage), false], [storage.setItem.mock.calls.length, 1]);
    deepEqual([readJsonStorage("", { safe: true }, storage), { safe: true }], [readJsonStorage(null, { safe: true }, storage), { safe: true }]);
    equal([storage.getItem.mock.calls.length, 0]);
    deepEqual([readJsonStorage("missing", { safe: true }, storage), { safe: true }]);
    values.set("bad", "[");
    deepEqual([readJsonStorage("bad", { safe: true }, storage), { safe: true }]);
    values.set("array", "[]");
    deepEqual([readJsonStorage("array", { safe: true }, storage), { safe: true }]);
    values.set("null", "null");
    deepEqual([readJsonStorage("null", { safe: true }, storage), { safe: true }]);
    values.set("primitive", "1");
    deepEqual([readJsonStorage("primitive", { safe: true }, storage), { safe: true }]);
    equal([writeJsonStorage("x", {}, null), false], [writeJsonStorage("x", {}, {}), false], [writeJsonStorage(null, {}, storage), false]);
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("blocked");
      }
    });
    equal([getBrowserStorage(), null]);
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
    equal([writeJsonStorage("x", 1n, { setItem: () => {} }), false], [writeJsonStorage( "x", {}, { setItem: () => { throw new Error("full"); } } ), false]);
    deepEqual([readJsonStorage( "x", { safe: true }, { getItem: () => { throw new Error("blocked"); } } ), { safe: true }]);
  });
});
describe("karaoke domain utilities", () => {
  test("transport and timeline clamp invalid positions", () => {
    equal([clampPlaybackPosition(-2, 10), 0], [clampPlaybackPosition("bad", 10), 0], [clampPlaybackPosition(12, 10), 10], [clampPlaybackPosition(2, 0), 2], [shouldSyncMedia(1, 1.2), true], [shouldSyncMedia(1, 1.04), false], [shouldSyncMedia(1, 1.09), true], [shouldSyncMedia(1, 1.01, -1), true], [shouldSyncMedia(1, "bad"), false], [shouldSyncMedia(1, 1, 0), false], [shouldSyncMedia("x", 1), false], [getSecondaryMediaPosition(12, 10), 10], [getSecondaryMediaPosition(8, 0), 8], [getSecondaryMediaPosition(8, -1), 8], [getSecondaryMediaPosition(8, NaN), 8], [getSecondaryMediaPosition(-2, 0), 0]);
    deepEqual([createPlayerSyncCommand("play", "s", "x"), { type: "karaoke-player", action: "play", songId: "s", position: 0 }]);
    equal([createPlayerSyncCommand("seek", "s", 5).position, 5], [getMicrophoneLevel({ rms_db: -30 }), 50], [getMicrophoneLevel({ rms_dbfs: -100 }), 0], [getMicrophoneLevel(null), 0], [getTimelineProgress(5, 10), 0.5], [getTimelineProgress(5, 0), 0], [getTimelineProgress("bad", 10), 0], [getSeekTime(75, 25, 100, 20), 10], [getSeekTime("x", 0, 10, 10), null], [getSeekTime(5, 0, 0, 10), null], [getSeekTime(5, 0, 10, 0), null], [getSecondaryMediaPosition("bad", 10), 0]);
  });
  test("formatting, layout and result readiness stay deterministic", () => {
    equal([formatTime(65), "1:05"], [formatTime(-2), "0:00"], [formatTime(NaN), "0:00"], [midiToWesternNote(69), "A4"], [midiToWesternNote(NaN), "—"]);
    deepEqual([Array.from({ length: 12 }, (_, index) => midiToWesternNote(60 + index)), ["C4", "C♯4", "D4", "D♯4", "E4", "F4", "F♯4", "G4", "G♯4", "A4", "A♯4", "B4"]]);
    equal([midiToWesternNote(-1), "B-2"], [formatCompactKey(" C major "), "Cmaj"], [formatCompactKey("Cmajor"), "Cmaj"], [formatCompactKey("C   major"), "Cmaj"], [formatCompactKey("A minor"), "Am"], [formatCompactKey("Aminor"), "Am"], [formatCompactKey("Am major"), "Amaj"], [formatCompactKey("Am major chord"), "Ammajchord"], [formatCompactKey(null), "—"], [shouldLoadKaraokeResult({ id: "1", status: "done" }), true], [shouldLoadKaraokeResult({ id: "1", status: "processing" }), false], [shouldLoadKaraokeResult(null), false]);
    deepEqual([getKaraokeStageLayout({ mainWidth: 1600, mainHeight: 900, stageWidth: 800, stageHeight: 450 }), { navExtra: 0, videoWidth: 802, videoHeight: 452 }], [getKaraokeStageLayout({ mainWidth: "bad", mainHeight: null, stageWidth: undefined, stageHeight: NaN, currentNavExtra: -1 }), { navExtra: 0, videoWidth: 2, videoHeight: 2 }], [getKaraokeStageLayout({ mainWidth: 1000, mainHeight: 800, stageWidth: 100, stageHeight: 500, currentNavExtra: 50 }), { navExtra: 287.5, videoWidth: 891, videoHeight: 502 }], [getKaraokeStageLayout({ mainWidth: 1000, mainHeight: 500, stageWidth: 1000, stageHeight: 100, currentNavExtra: 100 }), { navExtra: 37.5, videoWidth: 1002, videoHeight: 565 }]);
    equal([normalizeAudioRuntimeSettings({ monitoring_enabled: "yes" }).monitoringEnabled, true], [normalizeAudioRuntimeSettings({ monitoring_enabled: "unknown" }).monitoringEnabled, true], [normalizeAudioRuntimeSettings({ volume: "bad", audio_driver: 1, asio_driver_name: null, buffer_size: -1, monitoring_enabled: 0, output_device_id: {} }).audioDriver, "auto"]);
  });
  test("audio device settings are normalized and matched", () => {
    deepEqual([normalizeAudioEffects({ reverb: 2, echo: -1, delay: "0.5" }), { reverb: 1, echo: 0, delay: 0.5 }], [normalizeAudioEffects(null), { reverb: 0, echo: 0, delay: 0 }], [normalizeAudioRuntimeSettings({ volume: 2, audio_driver: "asio", asio_driver_name: "X", buffer_size: 128, monitoring_enabled: "off", output_device_id: 7 }), { volume: 2, audioDriver: "asio", asioDriverName: "X", bufferSize: 128, monitoringEnabled: false, outputDeviceId: 7 }], [normalizeAudioRuntimeSettings(null), { volume: 0, audioDriver: "auto", asioDriverName: "", bufferSize: 64, monitoringEnabled: false, outputDeviceId: "" }]);
    for (const value of ["false", "0", "off", "no", "", "  false  "])
      equal([normalizeAudioRuntimeSettings({ monitoring_enabled: value }).monitoringEnabled, false]);
    for (const value of ["true", "1", "on", "yes", "  true  "])
      equal([normalizeAudioRuntimeSettings({ monitoring_enabled: value }).monitoringEnabled, true]);
    for (const [value, expected] of [
      [0, 64],
      [-1, 64],
      [1.5, 64],
      ["128", 128]
    ])
      equal([normalizeAudioRuntimeSettings({ buffer_size: value }).bufferSize, expected]);
    deepEqual([normalizeAudioRuntimeSettings({ audio_driver: "", asio_driver_name: 42, output_device_id: true }), { volume: 0, audioDriver: "auto", asioDriverName: "", bufferSize: 64, monitoringEnabled: false, outputDeviceId: "" }]);
    equal([normalizeAudioRuntimeSettings({ output_device_id: "speaker" }).outputDeviceId, "speaker"]);
    const devices = [
      { name: "Other ASIO", is_asio: true },
      { name: "Focusrite USB ASIO", is_asio: true }
    ];
    equal([findDriverOutputDevice(devices, "Focusrite ASIO Driver"), devices[1]], [findDriverOutputDevice(devices, ""), devices[0]]);
    const tokenMatch = { name: "Focusrite USB", is_asio: false };
    const asioOnly = { name: "Other", is_asio: true };
    equal([findDriverOutputDevice([asioOnly, tokenMatch], "Focusrite Driver"), tokenMatch]);
    const asioMatch = { name: "Focusrite", is_asio: true };
    const twoTokenMatch = { name: "Focusrite USB", is_asio: false };
    equal([findDriverOutputDevice([twoTokenMatch, asioMatch], "Focusrite ASIO Driver"), asioMatch], [findDriverOutputDevice([{ name: "was here!", is_asio: false }, asioMatch], "Focusrite ASIO"), asioMatch], [findDriverOutputDevice([{ name: "AB", is_asio: false }], "AB"), null], [findDriverOutputDevice([null], "Focusrite"), null], [findDriverOutputDevice([{ name: "Stryker was here", is_asio: false }], null), null], [findDriverOutputDevice([{ id: 1, is_asio: false }], "Stryker was here"), null], [findDriverOutputDevice(null, "anything"), null], [findDriverOutputDevice([{ name: null, is_asio: false }], "anything"), null], [findMatchingBrowserOutput( [{ kind: "audiooutput", deviceId: "x", label: "Focusrite USB" }], devices[1] ).deviceId, "x"], [findMatchingBrowserOutput([], {}), null], [findMatchingBrowserOutput([{ kind: "audiooutput", deviceId: "x", label: "Focusrite" }], null), null], [findMatchingBrowserOutput( [{ kind: "audiooutput", deviceId: "x", label: "Stryker was here!" }], null ), null], [findMatchingBrowserOutput([{ kind: "audiooutput", deviceId: "x", label: "Focusrite" }], { name: " " }), null], [findMatchingBrowserOutput(null, devices[1]), null], [findMatchingBrowserOutput( [{ kind: "audioinput", deviceId: "x", label: "Focusrite" }], devices[1] ), null], [findMatchingBrowserOutput( [{ kind: "audiooutput", deviceId: "x", label: "Completely Different" }], { name: "Focusrite USB" } ), null], [findMatchingBrowserOutput( [{ kind: "audiooutput", deviceId: "x", label: " Focusrite USB " }], { name: " Focusrite USB " } ).deviceId, "x"], [findMatchingBrowserOutput([{ kind: "audiooutput", deviceId: "x", label: "Focusrite USB" }], { name: " Focusrite " }).deviceId, "x"], [findMatchingBrowserOutput([{ kind: "audiooutput", deviceId: "x", label: " Focusrite " }], { name: "Focusrite USB" }).deviceId, "x"], [findMatchingBrowserOutput([{ kind: "audiooutput", deviceId: "x", label: null }], { name: "Stryker was here!" }), null], [findMatchingBrowserOutput([null], devices[1]), null], [findMatchingBrowserOutput( [ { kind: "audiooutput", deviceId: "", label: "Focusrite" }, { kind: "audiooutput", deviceId: "x", label: null } ], devices[1] ), null], [findMatchingBrowserOutput( [{ kind: "audiooutput", deviceId: "x", label: "Focusrite USB ASIO Pro" }], { name: "Focusrite USB" } ).deviceId, "x"]);
    deepEqual([groupBrowserAudioDevices([ { kind: "audioinput", id: 1 }, { kind: "audiooutput", id: 2 }, { kind: "video", id: 3 } ]), { inputs: [{ kind: "audioinput", id: 1 }], outputs: [{ kind: "audiooutput", id: 2 }] }], [groupBrowserAudioDevices(null), { inputs: [], outputs: [] }], [groupBrowserAudioDevices([null]), { inputs: [], outputs: [] }]);
  });
  test("melody guide and note normalization reject corrupt analysis", () => {
    equal([Math.round(midiToFrequency(69)), 440], [Math.round(midiToFrequency(81)), 880], [Math.round(midiToFrequency(57)), 220], [midiToFrequency("x"), null]);
    const notes = [{ start: 1, end: 2, midi: 69 }];
    equal([findActiveMelodyNote(notes, 1.5), notes[0]], [findActiveMelodyNote(notes, 1), notes[0]], [findActiveMelodyNote(notes, 2), null], [findActiveMelodyNote([null], 1), null], [findActiveMelodyNote([{ start: 1, end: "bad" }], 1), null], [findActiveMelodyNote([{ start: "bad", end: 2 }], 1), null], [findActiveMelodyNote({}, 1), null], [getMelodyGuideState({ notes, position: 1.5, volume: 1 }).active, true]);
    const shiftedGuide = getMelodyGuideState({ notes, position: 1.5, keyShift: 12, volume: 0.5 });
    equal([Math.round(shiftedGuide.frequency), 880], [shiftedGuide.gain, 0.3 * 0.5 ** 1.65], [getMelodyGuideState({ notes, position: 0, volume: 1 }).active, false], [getMelodyGuideState({ notes, position: 1.5, volume: "bad" }).active, false], [getMelodyGuideState({ notes: [{ start: 0, end: 1, midi: "bad" }], position: 0.5, volume: 1 }) .active, false]);
    deepEqual([normalizeNoteList( [ null, { start: 2, end: 3, midi_note: 60, word_index: 1 }, { start: 0, end: 1, note: "A", syllableIndex: 2 }, { start: 0, end: 0, midi: 60 } ], (name) => (name === "A" ? 69 : NaN) ).map(({ start, midi }) => ({ start, midi })), [ { start: 0, midi: 69 }, { start: 2, midi: 60 } ]]);
    const callableNote = () => {};
    Object.assign(callableNote, { start: 0, end: 1, midi: 60 });
    deepEqual([normalizeNoteList([callableNote]), []], [normalizeNoteList([ { start: 0, end: 1, midi: 0 }, { start: 1, end: 2, midi: 127 }, { start: -1, end: 1, midi: 60 }, { start: 2, end: 1, midi: 60 }, { start: 0, end: "bad", midi: 60 }, { start: 0, end: 1, midi: -1 }, { start: 0, end: 1, midi: 128 }, { start: undefined, end: 1, midi: 60 } ]).map(({ midi }) => midi), [0, 127]], [normalizeNoteList([{ start: 0, end: 1, note: "A" }]), []], [normalizeNoteList(null), []], [normalizeNoteList([{ start: 0, end: 1, note: "unknown" }]), []], [normalizeNoteList([ { start: 0, end: 2, midi: 61, wordIndex: 2, syllableIndex: 3 }, { start: 0, end: 1, midi: 62 }, { start: 0, end: 1, midi: 60 } ]).map(({ midi, wordIndex, syllableIndex }) => ({ midi, wordIndex, syllableIndex })), [ { midi: 60, wordIndex: null, syllableIndex: null }, { midi: 62, wordIndex: null, syllableIndex: null }, { midi: 61, wordIndex: 2, syllableIndex: 3 } ]], [getPanoramaPosition(0, 1000, {}), { x: 0, y: 48 }], [getPanoramaPosition(1, 0, {}), { x: 0, y: 48 }], [getPanoramaPosition(1, -1, {}), { x: 0, y: 48 }], [getPanoramaPosition(1, Infinity, {}), { x: 0, y: 48 }], [getPanoramaPosition("bad", 1000, null), { x: 0, y: 48 }], [getPanoramaPosition(250, 1000, {}), { x: 16, y: 49.2 }], [getPanoramaPosition(1250, 1000, {}), { x: 16, y: 49.2 }], [getPanoramaPosition(-250, 1000, {}), { x: -16, y: 46.8 }], [getPanoramaPosition(250, 1000, { xPhaseA: 0.2, xPhaseB: 0.4, xPhaseC: 0.6, yPhaseA: 0.8, yPhaseB: 1 }), { x: 1.979360053568512, y: 44.195288348954584 }], [getPanoramaPosition(137, 1000, { xPhaseA: 0.2, xPhaseB: 0.4, xPhaseC: 0.6, yPhaseA: 0.8, yPhaseB: 1 }), { x: 1.0037174421043353, y: 45.66700030928629 }]);
  });
  test("karaoke preferences persist only normalized values", async () => {
    const {
      KARAOKE_PREFERENCES_KEY,
      loadKaraokePreferences,
      normalizeKaraokePreferences,
      saveKaraokePreferences
    } = await loadKaraokePreferencesUtility();
    equal([KARAOKE_PREFERENCES_KEY, "karaoke-player-preferences"]);
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
    deepEqual([normalized, { musicVolume: 1, vocalVolume: 0, melodyVolume: 0.5, speed: 1.5, keyShift: 3, showLyrics: false, showNotes: true, autoHideConsole: true, effectPreset: "hall" }], [normalizeKaraokePreferences(null), { musicVolume: 1, vocalVolume: 1, melodyVolume: 0, speed: 1, keyShift: 0, showLyrics: true, showNotes: true, autoHideConsole: true, effectPreset: "studio" }]);
    equal([normalizeKaraokePreferences({ showLyrics: "unknown" }).showLyrics, true]);
    for (const value of ["false", "0", "no", "off", "", "  false  "])
      equal([normalizeKaraokePreferences({ showLyrics: value }).showLyrics, false]);
    equal([normalizeKaraokePreferences([]).effectPreset, "studio"]);
    const storage = {
      value: "",
      getItem(key) {
        equal([key, "karaoke-player-preferences"]);
        return this.value;
      },
      setItem(key, value) {
        equal([key, "karaoke-player-preferences"]);
        this.value = value;
      }
    };
    equal([saveKaraokePreferences(normalized, storage), true]);
    deepEqual([loadKaraokePreferences(storage), normalized], [loadKaraokePreferences({ getItem: () => "" }), normalizeKaraokePreferences({})], [loadKaraokePreferences({ getItem: () => "[" }), normalizeKaraokePreferences({})], [loadKaraokePreferences(null), normalizeKaraokePreferences({})]);
    equal([saveKaraokePreferences({}, null), false]);
    const callablePreferences = () => {};
    callablePreferences.effectPreset = "hall";
    equal([normalizeKaraokePreferences(callablePreferences).effectPreset, "studio"], [normalizeKaraokePreferences({ effectPreset: "   " }).effectPreset, "studio"], [saveKaraokePreferences( {}, { setItem: () => { throw new Error(); } } ), false]);
  });
});
describe("library and melody editor domain utilities", () => {
  test("library lists merge live processing state", () => {
    const songs = [
      { id: "1", title: "Hello", artist: "World", status: "queued" },
      { id: "2", genre: "Rock", status: "done" }
    ];
    equal([getProcessingProgress({ progress_percent: 120 }), 100], [getProcessingProgress({}, { progress_percent: "x" }), 0], [getProcessingProgress(null, { progress_percent: 25 }), 25], [getProcessingProgress(null, null), 0]);
    for (const status of ["processing", "queued", "cancelling"])
      equal([isProcessingActive(status), true]);
    for (const status of ["done", "pending", "", null])
      equal([isProcessingActive(status), false]);
    equal([hasActiveSongProcessing(songs), true], [mergeSongProcessingStatus(songs, { song_id: "1", status: "processing", progress_percent: 20 })[0].progress_percent, 20], [getLocalVisibleSongs(songs, new Set(["1"])).length, 1], [resolveVisibleSongs({ localSongs: songs, room: { host: false }, roomSongs: [songs[1], null] }) .length, 1], [filterSongs(songs, "world").length, 1], [filterSongs(songs, "").length, 2], [countReadySongs(songs), 1]);
    deepEqual([getSongCardState(songs[1]), { status: "done", isWorking: false, isReady: true }]);
    equal([hasActiveSongProcessing([{ status: null }]), false], [hasActiveSongProcessing([null, { status: "done" }]), false], [hasActiveSongProcessing(null), false]);
    deepEqual([mergeSongProcessingStatus(null, null), []]);
    equal([mergeSongProcessingStatus("bad", { song_id: "1" }), "bad"], [mergeSongProcessingStatus(songs, null), songs], [mergeSongProcessingStatus(songs, {}), songs]);
    const mixedSongs = [null, songs[1], songs[0]];
    deepEqual([mergeSongProcessingStatus(mixedSongs, { song_id: "1", status: "processing" }), [ null, songs[1], { ...songs[0], status: "processing", progress_step: undefined, progress_percent: undefined, error_message: undefined } ]], [mergeSongProcessingStatus( [ { id: "1", status: "old", progress_step: "step", progress_percent: 5, error_message: "error" } ], { song_id: "1" } )[0], { id: "1", status: "old", progress_step: "step", progress_percent: 5, error_message: "error" }]);
    equal([getLocalVisibleSongs(songs, null).length, 2]);
    deepEqual([getLocalVisibleSongs([null, "bad", songs[0], songs[1]], new Set(["2"])), [ songs[0] ]], [getLocalVisibleSongs(null, null), []], [resolveVisibleSongs({ localSongs: null, room: null, roomSongs: null }), []]);
    equal([resolveVisibleSongs({ localSongs: songs, room: { host: true }, roomSongs: [] }), songs]);
    deepEqual([resolveVisibleSongs({ localSongs: songs, room: { host: false }, roomSongs: [null, "bad", songs[1]] }), [songs[1]]]);
    equal([resolveVisibleSongs({ localSongs: songs, room: { host: false }, roomSongs: null }), songs]);
    deepEqual([filterSongs(null, null), []]);
    equal([filterSongs(songs, ""), songs], [filterSongs(songs, "   "), songs], [filterSongs(songs, "  WORLD  ")[0], songs[0]], [filterSongs(songs, "rock")[0], songs[1]]);
    deepEqual([filterSongs([null, {}, songs[0]], "hello"), [songs[0]]]);
    const joinedSongs = [
      { title: "alpha", artist: "beta" },
      { title: "alpha", artist: " ", genre: "beta" },
      { title: {} }
    ];
    deepEqual([filterSongs(joinedSongs, "alpha beta"), joinedSongs.slice(0, 2)], [filterSongs([{ title: "alpha", artist: " " }], "alpha "), [ { title: "alpha", artist: " " } ]], [filterSongs([joinedSongs[2]], "object"), []], [filterSongs(songs, 7), songs]);
    equal([countReadySongs(null), 0], [countReadySongs([null, { status: "pending" }, songs[1]]), 1], [getSongCardState(null).status, "pending"]);
    for (const [status, expected] of [
      ["processing", { isWorking: true, isReady: false }],
      ["queued", { isWorking: true, isReady: false }],
      ["cancelling", { isWorking: true, isReady: false }],
      ["done", { isWorking: false, isReady: true }],
      ["pending", { isWorking: false, isReady: false }]
    ])
      deepEqual([getSongCardState({ status }), { status, ...expected }]);
  });
  test("editor geometry remains bounded", () => {
    equal([clampEditor(20, 0, 10), 10], [anchoredHorizontalScroll({ time: 5, oldZoom: 10, newZoom: 20, keyboardWidth: 10, scrollLeft: 20, clientWidth: 100, scrollWidth: 500 }), 70], [anchoredVerticalScroll({ scrollTop: 50, clientHeight: 100, oldRowHeight: 10, newRowHeight: 20, rowCount: 20 }), 150], [autoFollowScrollLeft({ playheadX: 40, scrollLeft: 0, clientWidth: 100, keyboardWidth: 20, scrollWidth: 500 }), 0], [autoFollowScrollLeft({ playheadX: 100, scrollLeft: 0, clientWidth: 100, keyboardWidth: 20, scrollWidth: 500 }), 40], [anchoredVerticalScrollToNote({ noteMidi: 60, maxMidi: 70, oldRowHeight: 10, newRowHeight: 20, scrollTop: 50, clientHeight: 100, rowCount: 20 }), 155]);
    deepEqual([marqueeHitIds({ notes: [{ _id: "n", start: 1, end: 2, midi_note: 60 }], x1: 5, y1: 5, x2: 40, y2: 30, keyboardWidth: 10, zoom: 10, rowHeight: 10, maxMidi: 62 }), ["n"]], [marqueeHitIds({ notes: null, x1: 0, y1: 0, x2: 1, y2: 1, keyboardWidth: 0, zoom: 1, rowHeight: 10, maxMidi: 0 }), []], [marqueeHitIds({ notes: [{ _id: "zero", start: 0, end: 0, midi_note: 0 }], x1: 0, y1: 0, x2: 20, y2: 20, keyboardWidth: 0, zoom: 1, rowHeight: 10, maxMidi: 0 }), ["zero"]]);
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
    deepEqual([merged.notes[0].syllable_indices, [0, 1, 2]]);
    equal([merged.notes[0].editor_text, "Большой"], [displayTextForNote(notes[0], syllables, new Map([[0, "a"]])), "Бол"], [displayTextForNote(notes[0], syllables, new Map()), ""], [deleteNotesAndTransferText(notes, ["a"], syllables)[0].editor_text, "Большой"], [adjacentNoteId(notes, [], 1), "a"], [adjacentNoteId(notes, ["a"], 1), "b"], [constrainedMoveDelta(notes, ["a"], 5, 10), 0]);
    deepEqual([resizeBounds(notes, "a", 10), { minStart: 0, maxStart: 0.97, minEnd: 0.03, maxEnd: 1 }]);
    equal([resizeBounds(notes, "missing", 10), null]);
  });
  test("note editing covers text-transfer and boundary edge cases", () => {
    const syllables = new Map([
      [0, { text: "hel", word_index: 1 }],
      [1, { text: "ello", word_index: 1 }],
      [2, { text: "world", word_index: 2 }]
    ]);
    const notes = [
      { _id: "a", start: 0, end: 1, midi_note: 60, syllable_index: 0 },
      {
        _id: "b",
        start: 1,
        end: 2,
        midi_note: 61,
        syllable_index: 1,
        editor_text: "ello"
      },
      { _id: "c", start: 2, end: 3, midi_note: 62, syllable_index: 2 }
    ];
    equal([mergeSelectedNotes(notes, [], syllables).selectedId, null], [mergeSelectedNotes(notes, ["a", "b"], syllables).notes.find(({ _id }) => _id === "a") .editor_text, "hello"], [mergeSelectedNotes( [ { ...notes[0], editor_text: "hello", word_index: 1 }, { ...notes[1], editor_text: "lo", word_index: 1 } ], ["a", "b"], syllables ).notes[0].editor_text, "hello"], [mergeSelectedNotes(notes, ["a", "c"], syllables).notes.find(({ _id }) => _id === "a") .editor_text, "hel world"], [mergeSelectedNotes( [ { ...notes[0], editor_text: "ab", word_index: 1 }, { ...notes[1], editor_text: "cd", word_index: 1 } ], ["a", "b"], syllables ).notes[0].editor_text, "abcd"], [mergeSelectedNotes( [ { ...notes[0], editor_text: "left", word_index: 1 }, { ...notes[1], editor_text: "", syllable_index: 99, word_index: 1 } ], ["a", "b"], syllables ).notes[0].editor_text, "left"], [displayTextForNote({ ...notes[0], editor_text: "edited" }, syllables, new Map()), "edited"]);
    const withoutText = [{ ...notes[0], editor_text: "", syllable_index: NaN }];
    deepEqual([deleteNotesAndTransferText([...withoutText, notes[1]], ["a"], syllables), [ notes[1] ]]);
    equal([deleteNotesAndTransferText([notes[1], notes[0], notes[2]], ["b", "a"], syllables).length, 1], [adjacentNoteId([], [], 1), null], [adjacentNoteId(notes, [], -1), "c"], [adjacentNoteId(notes, ["b"], -1), "a"], [adjacentNoteId(notes, ["c"], -1), "b"], [adjacentNoteId( [ { _id: "high", start: 0, end: 1, midi_note: 62 }, { _id: "low", start: 0, end: 1, midi_note: 60 } ], [], 1 ), "low"], [constrainedMoveDelta(notes, [], 1, 10), 0], [constrainedMoveDelta(notes, ["b"], -5, 10), 0], [resizeBounds(notes, "b", 10).minStart, 1], [displayTextForNote( { _id: "missing", syllable_index: 42 }, new Map(), new Map([[42, "missing"]]) ), ""], [mergeSelectedNotes( [ { _id: "empty-a", start: 0, end: 1, midi_note: 60, syllable_index: NaN }, { _id: "empty-b", start: 0, end: 2, midi_note: 62, syllable_index: NaN } ], ["empty-a", "empty-b"], new Map() ).notes[0].editor_text, ""], [mergeSelectedNotes( [ { _id: "low", start: 0, end: 2, midi_note: 50 }, { _id: "a", start: 0, end: 1, midi_note: 60 }, { _id: "b", start: 1, end: 2, midi_note: 62 } ], ["a", "b"], new Map() ).notes[0]._id, "low"], [deleteNotesAndTransferText(notes, [], syllables).length, 3]);
    deepEqual([deleteNotesAndTransferText(notes, ["a", "b", "c"], syllables), []]);
    const transferredRight = deleteNotesAndTransferText(
      [
        { _id: "right", start: 2, end: 3, midi_note: 62 },
        { _id: "gone", start: 1, end: 2, midi_note: 61, editor_text: "middle" },
        { _id: "left", start: 0, end: 1, midi_note: 60 }
      ],
      ["gone"],
      new Map()
    );
    equal([transferredRight[0].editor_text, "middle"], [deleteNotesAndTransferText( [ { _id: "same-high", start: 0, end: 1, midi_note: 62 }, { _id: "same-low", start: 0, end: 1, midi_note: 60 }, { _id: "after", start: 2, end: 3, midi_note: 64, editor_text: "after" } ], ["after"], new Map() )[0]._id, "same-low"]);
  });
});
