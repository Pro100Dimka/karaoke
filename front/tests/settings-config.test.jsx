/* @vitest-environment jsdom */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { translateSaved } from "../src/i18n/runtime.js";
import { same, sameDeep, verify } from "./helpers/assertions.mjs";
let config;
let screenConfigs;
let settingsUtils;
let runtimeApi;
beforeEach(async () => {
  vi.resetModules();
  config = await import("../src/pages/Settings/config.jsx");
  const [diagnostics, history, memory, utils, client] = await Promise.all([
    import("../src/pages/Settings/screens/diagnostics/config.js"),
    import("../src/pages/Settings/screens/history/config.js"),
    import("../src/pages/Settings/screens/memory/config.js"),
    import("../src/pages/Settings/utils.js"),
    import("../src/api/client.js")
  ]);
  screenConfigs = { diagnostics, history, memory };
  settingsUtils = utils;
  runtimeApi = client.api;
});
afterEach(() => { delete globalThis.electronAPI; });
const field = (section, name) =>
  config.SETTINGS[section].fields.find((item) => item.name === name);
test("settings catalog exposes stable tabs, screens and options", () => {
  verify([Object.keys(config.SETTINGS), 'toEqual', ["appearance", "audio", "ai"]], [config.FULL, 'toBe', 12], [config.SETTINGS_TABS.map(({ id }) => id), 'toEqual', [ "appearance", "audio", "ai" ]], [field("audio", "input_device_id"), 'toBeDefined'], [field("audio", "noise_suppression"), 'toBeDefined']);
  verify([config.SERVICE_SCREENS.every(({ id }) => config.SCREEN_BY_ID[id]), 'toBe', true]);
  verify([config.EMPTY_BROWSER_DEVICES, 'toEqual', { inputs: [], outputs: [] }], [Object.isFrozen(config.EMPTY_BROWSER_DEVICES), 'toBe', true]);
});
test("radio and storage fields resolve runtime choices", async () => {
  const station = field("appearance", "stationId");
  expect(station.getOptions({ radio: null })).toEqual([]);
  verify([station.getOptions({ radio: { stations: [{ id: "one", name: "One", description: "Music" }] } }), 'toEqual', [{ value: "one", label: "One", description: "Music" }]]);
  expect(field("appearance", "volume").getLabel({ value: 0.42 })).toBe(
    `${translateSaved("Громкость")} · 42%`
  );
  const songsFolder = field("ai", "songs_folder");
  expect(await songsFolder.pick({}, "C:/Songs")).toBeNull();
  const selectFolder = vi.fn().mockResolvedValue("D:/Music");
  globalThis.electronAPI = { selectFolder };
  verify([await songsFolder.pick({}, "C:/Songs"), 'toBe', "D:/Music"], [selectFolder, 'toHaveBeenCalledWith', "C:/Songs"]);
  await songsFolder.pick({}, "");
  expect(selectFolder).toHaveBeenLastCalledWith(undefined);
});
test("audio action and monitor fields delegate to the audio controller", async () => {
  const speaker = field("audio", "speakerTest");
  const monitor = field("audio", "monitoringEnabled");
  const testSpeakers = vi.fn().mockResolvedValue(undefined);
  const toggleMonitoring = vi.fn().mockResolvedValue(undefined);
  const context = {
    audio: {
      actions: { testSpeakers, toggleMonitoring },
      states: {
        speakerTestState: "playing",
        monitoringEnabled: true,
        monitorLevel: 0.7,
        saving: false,
        togglingMonitoring: false
      }
    }
  };
  same([speaker.isPending(context), true], [speaker.isDisabled(context), true]);
  await speaker.run(context);
  expect(testSpeakers).toHaveBeenCalledOnce();
  same([monitor.getValue(context), true], [monitor.getLevel(context), 0.7], [monitor.isDisabled(context), false]);
  await monitor.run(context);
  expect(toggleMonitoring).toHaveBeenCalledOnce();
  const empty = { audio: { actions: {}, states: {} } };
  verify([monitor.getLevel(empty), 'toBe', 0], [monitor.isDisabled(empty), 'toBeFalsy'], [speaker.run(empty), 'toBeUndefined'], [monitor.run(empty), 'toBeUndefined']);
  const missing = { audio: {} };
  verify([speaker.run(missing), 'toBeUndefined'], [monitor.getValue(missing), 'toBeUndefined'], [monitor.getLevel(missing), 'toBe', 0], [monitor.isDisabled(missing), 'toBeUndefined'], [monitor.run(missing), 'toBeUndefined']);
  verify([monitor.isDisabled({ audio: { states: { saving: true, togglingMonitoring: false } } }), 'toBe', true]);
  verify([monitor.isDisabled({ audio: { states: { saving: false, togglingMonitoring: true } } }), 'toBe', true]);
  verify([monitor.isDisabled({ audio: { states: { saving: true, togglingMonitoring: true } } }), 'toBe', true]);
});
test("audio fields read the exact runtime option sources and labels", () => {
  const sources = {
    input_device_id: "inputDevices",
    output_device_id: "outputDevices"
  };
  const options = Object.fromEntries(
    Object.values(sources).map((source) => [source, [{ value: source }]])
  );
  for (const [name, source] of Object.entries(sources)) {
    expect(field("audio", name).getOptions({ audio: { options } })).toEqual([ { value: source } ]);
  }
  expect(field("audio", "volume").getLabel({ value: 0.42 })).toBe(
    `${translateSaved("Громкость голоса")} · 42%`
  );
});
test("settings field factories preserve their complete runtime contract", () => {
  sameDeep([settingsUtils.radioActions, { stationId: "setStation", volume: "setVolume" }], [settingsUtils.opts([[1, "One"]]), [ { value: 1, label: "One" } ]]);
  verify([settingsUtils.percent("Volume")({ value: 0.125 }), 'toBe', "Volume · 13%"]);
  expect(settingsUtils.percent("Volume")({})).toBe("Volume · 0%");
  const formFactories = {
    select: ["select", "change"],
    text: ["text", "blur"],
    number: ["number", "blur"],
    toggle: ["toggle", "change"],
    readonly: ["readonly", undefined],
    folder: ["folder", "change"]
  };
  for (const [kind, [type, save]] of Object.entries(formFactories)) {
    const descriptor = settingsUtils.FORM_FIELDS[kind]("setting");
    expect(descriptor).toMatchObject({ name: "setting", span: 6, type });
    verify([descriptor.save, 'toBe', save], [descriptor.getValue({}), 'toBeUndefined']);
  }
  const onChange = vi.fn();
  const onFieldBlur = vi.fn();
  const text = settingsUtils.FORM_FIELDS.text("setting", { span: 12 });
  same([text.span, 12], [text.getValue({ form: { setting: "before" } }), "before"]);
  text.setValue({ onChange }, "after");
  text.saveValue({ onFieldBlur }, "after");
  expect(onChange).toHaveBeenCalledExactlyOnceWith("setting", "after");
  expect(onFieldBlur).toHaveBeenCalledExactlyOnceWith("setting", "after");
  const factory = vi.fn((name, fieldConfig) => ({ name, ...fieldConfig }));
  verify([settingsUtils.fieldType(factory, "custom")("field", { extra: 1 }), 'toEqual', { name: "field", type: "custom", extra: 1 }]);
  expect(factory).toHaveBeenCalledExactlyOnceWith("field", { type: "custom", extra: 1 });
});
test("settings runtime fields handle exact present and absent controller states", () => {
  const setStation = vi.fn();
  const station = settingsUtils.radioField("stationId");
  verify([station.getValue({ radio: { stationId: "one" } }), 'toBe', "one"], [station.getValue({}), 'toBeUndefined'], [station.setValue({}, "two"), 'toBeUndefined'], [station.setValue({ radio: {} }, "two"), 'toBeUndefined']);
  station.setValue({ radio: { setStation } }, "two");
  expect(setStation).toHaveBeenCalledExactlyOnceWith("two");
  const updateBackend = vi.fn();
  const slider = settingsUtils.audioSlider("volume");
  expect(slider).toMatchObject({ name: "volume", span: 6, type: "slider" });
  verify([slider.getValue({ audio: {} }), 'toBeUndefined'], [slider.getValue({ audio: { values: { volume: 0.4 } } }), 'toBe', 0.4]);
  slider.setValue({ audio: { updateBackend } }, 0.7);
  expect(updateBackend).toHaveBeenCalledExactlyOnceWith({ volume: 0.7 });
  const updatePreference = vi.fn();
  const preference = settingsUtils.preferenceSelect(
    "monitorInputDeviceId",
    [{ value: "default" }],
    { span: 12 }
  );
  verify([preference, 'toMatchObject', { name: "monitorInputDeviceId", span: 12, type: "select", options: [{ value: "default" }] }]);
  expect(preference.getValue({ audio: {} })).toBeUndefined();
  verify([preference.getValue({ audio: { preferences: { monitorInputDeviceId: "default" } } }), 'toBe', "default"]);
  preference.setValue({ audio: { updatePreference } }, "mic");
  expect(updatePreference).toHaveBeenCalledExactlyOnceWith( "monitorInputDeviceId", "mic"
  );
  const dynamic = settingsUtils.audioSelect("device", "devices");
  verify([dynamic.type, 'toBe', "select"], [dynamic.getOptions({ audio: {} }), 'toEqual', []]);
  verify([dynamic.getOptions({ audio: { options: { devices: [{ value: "mic" }] } } }), 'toEqual', [{ value: "mic" }]]);
});
test("settings predicates distinguish every controller state", () => {
  same([settingsUtils.monitorDisabled({ audio: {} }), false], [settingsUtils.monitorDisabled({ audio: { states: {} } }), false]);
  verify([settingsUtils.monitorDisabled({ audio: { states: { monitoringEnabled: true } } }), 'toBe', true]);
  expect(settingsUtils.audioDriverVisible({ audio: {} })).toBe(false);
  verify([settingsUtils.audioDriverVisible({ audio: { values: {} } }), 'toBe', false]);
  verify([settingsUtils.audioDriverVisible({ audio: { values: { audio_driver: "asio" } } }), 'toBe', true]);
  verify([settingsUtils.audioDriverVisible({ audio: { values: { audio_driver: "wasapi" } } }), 'toBe', false]);
  verify([settingsUtils.multipleAudioDriversAvailable({ audio: {} }), 'toBe', false]);
  verify([settingsUtils.multipleAudioDriversAvailable({ audio: { options: {} } }), 'toBe', false]);
  verify([settingsUtils.multipleAudioDriversAvailable({ audio: { options: { audioDrivers: ["one"] } } }), 'toBe', false]);
  verify([settingsUtils.multipleAudioDriversAvailable({ audio: { options: { audioDrivers: ["one", "two"] } } }), 'toBe', true]);
  same([settingsUtils.speakerPlaying({ audio: {} }), false], [settingsUtils.speakerPlaying({ audio: { states: {} } }), false]);
  verify([settingsUtils.speakerPlaying({ audio: { states: { speakerTestState: "playing" } } }), 'toBe', true]);
  verify([settingsUtils.speakerPlaying({ audio: { states: { speakerTestState: "idle" } } }), 'toBe', false]);
});
test("service-screen configuration has an exact static and runtime contract", () => {
  expect(Object.keys(screenConfigs).sort()).toEqual(["diagnostics", "history", "memory"]);
  verify([screenConfigs.diagnostics.PIPELINE_CHECKS, 'toEqual', [ "ai_dir_found", "ffmpeg_available", "whisper_available", "demucs_available", "cuda_available", "torch_available" ]]);
  expect(Object.keys(screenConfigs.diagnostics.STATUS_ICONS)).toEqual([ "success", "error" ]);
  verify([screenConfigs.history.HISTORY_COLUMNS, 'toEqual', [ "song", "action", "status", "duration", "date" ]]);
  sameDeep([[...screenConfigs.history.HISTORY_ACTIONS], [ "processing", "recording" ]], [[...screenConfigs.history.RECORDING_STATUSES], [ "analyzed", "recorded" ]]);
  const { MEMORY_ACTIONS: actions } = screenConfigs.memory;
  same([actions[0][4], runtimeApi.clearCache], [actions[1][4], runtimeApi.deleteTemp]);
  verify([actions[0][5]({ freed_bytes: 1024 ** 2 }), 'toBe', translateSaved("Освобождено: {0}", { 0: translateSaved("{0} МБ", { 0: "1.0" }) })]);
  verify([actions[1][5]({ freed_bytes: 2 * 1024 ** 2 }), 'toBe', translateSaved("Удалено временных файлов: {0}", { 0: translateSaved("{0} МБ", { 0: "2.0" }) })]);
  verify([screenConfigs.memory.buildOptimizeOptions([ { id: "ready", title: "Ready", status: "done" }, { id: "optimized", title: "Optimized", status: "done", optimized: true }, { id: "pending", title: "Pending", status: "pending" } ]), 'toEqual', [ screenConfigs.memory.DEFAULT_OPTIMIZE_OPTION, { value: "ready", label: "Ready" } ]]);
  verify([screenConfigs.memory.buildOptimizeOptions(), 'toEqual', [ screenConfigs.memory.DEFAULT_OPTIMIZE_OPTION ]]);
});
