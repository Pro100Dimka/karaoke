/* @vitest-environment jsdom */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { translateSaved } from "../src/i18n/runtime.js";

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

afterEach(() => {
  delete globalThis.electronAPI;
});

const field = (section, name) => config.SETTINGS[section].fields.find((item) => item.name === name);

const canonicalize = (value) => {
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  );
};

const digest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");

test("settings catalog exposes stable tabs, screens and options", () => {
  expect(Object.keys(config.SETTINGS)).toEqual(["appearance", "audio", "ai"]);
  expect(config.FULL).toBe(12);
  expect(config.SETTINGS_TABS.map(({ id }) => id)).toEqual(["appearance", "audio", "ai"]);
  expect(field("audio", "monitorLatencyHint")).toBeUndefined();
  expect(field("audio", "monitorInputDeviceId")).toBeUndefined();
  expect(config.SERVICE_SCREENS.every(({ id }) => config.SCREEN_BY_ID[id])).toBe(true);
  expect(config.EMPTY_BROWSER_DEVICES).toEqual({ inputs: [], outputs: [] });
  expect(Object.isFrozen(config.EMPTY_BROWSER_DEVICES)).toBe(true);
});

test("radio and storage fields resolve runtime choices", async () => {
  const station = field("appearance", "stationId");
  expect(station.getOptions({ radio: null })).toEqual([]);
  expect(
    station.getOptions({ radio: { stations: [{ id: "one", name: "One", description: "Music" }] } })
  ).toEqual([{ value: "one", label: "One", description: "Music" }]);
  expect(field("appearance", "volume").getLabel({ value: 0.42 })).toBe(
    `${translateSaved("Громкость")} · 42%`
  );

  const songsFolder = field("ai", "songs_folder");
  expect(await songsFolder.pick({}, "C:/Songs")).toBeNull();
  const selectFolder = vi.fn().mockResolvedValue("D:/Music");
  globalThis.electronAPI = { selectFolder };
  expect(await songsFolder.pick({}, "C:/Songs")).toBe("D:/Music");
  expect(selectFolder).toHaveBeenCalledWith("C:/Songs");
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

  expect(speaker.isPending(context)).toBe(true);
  expect(speaker.isDisabled(context)).toBe(true);
  await speaker.run(context);
  expect(testSpeakers).toHaveBeenCalledOnce();
  expect(monitor.getValue(context)).toBe(true);
  expect(monitor.getLevel(context)).toBe(0.7);
  expect(monitor.isDisabled(context)).toBe(false);
  await monitor.run(context);
  expect(toggleMonitoring).toHaveBeenCalledOnce();

  const empty = { audio: { actions: {}, states: {} } };
  expect(monitor.getLevel(empty)).toBe(0);
  expect(monitor.isDisabled(empty)).toBeFalsy();
  expect(speaker.run(empty)).toBeUndefined();
  expect(monitor.run(empty)).toBeUndefined();

  const missing = { audio: {} };
  expect(speaker.run(missing)).toBeUndefined();
  expect(monitor.getValue(missing)).toBeUndefined();
  expect(monitor.getLevel(missing)).toBe(0);
  expect(monitor.isDisabled(missing)).toBeUndefined();
  expect(monitor.run(missing)).toBeUndefined();

  expect(
    monitor.isDisabled({ audio: { states: { saving: true, togglingMonitoring: false } } })
  ).toBe(true);
  expect(
    monitor.isDisabled({ audio: { states: { saving: false, togglingMonitoring: true } } })
  ).toBe(true);
  expect(
    monitor.isDisabled({ audio: { states: { saving: true, togglingMonitoring: true } } })
  ).toBe(true);
});

test("audio fields read the exact runtime option sources and labels", () => {
  const sources = {
    input_device_id: "inputDevices",
    output_device_id: "outputDevices",
    audio_driver: "audioDrivers",
    asio_driver_name: "asioDrivers",
    buffer_size: "bufferSizes",
    monitorInputDeviceId: "browserInputs",
    monitorOutputDeviceId: "browserOutputs"
  };
  const options = Object.fromEntries(
    Object.values(sources).map((source) => [source, [{ value: source }]])
  );
  for (const [name, source] of Object.entries(sources)) {
    expect(field("audio", name).getOptions({ audio: { options } })).toEqual([{ value: source }]);
  }
  expect(field("audio", "volume").getLabel({ value: 0.42 })).toBe(
    `${translateSaved("Громкость голоса")} · 42%`
  );
});

test("settings field factories preserve their complete runtime contract", () => {
  expect(settingsUtils.radioActions).toEqual({ stationId: "setStation", volume: "setVolume" });
  expect(settingsUtils.opts([[1, "One"]])).toEqual([{ value: 1, label: "One" }]);
  expect(settingsUtils.percent("Volume")({ value: 0.125 })).toBe("Volume · 13%");
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
    expect(descriptor.save).toBe(save);
    expect(descriptor.getValue({})).toBeUndefined();
  }

  const onChange = vi.fn();
  const onFieldBlur = vi.fn();
  const text = settingsUtils.FORM_FIELDS.text("setting", { span: 12 });
  expect(text.span).toBe(12);
  expect(text.getValue({ form: { setting: "before" } })).toBe("before");
  text.setValue({ onChange }, "after");
  text.saveValue({ onFieldBlur }, "after");
  expect(onChange).toHaveBeenCalledExactlyOnceWith("setting", "after");
  expect(onFieldBlur).toHaveBeenCalledExactlyOnceWith("setting", "after");

  const factory = vi.fn((name, fieldConfig) => ({ name, ...fieldConfig }));
  expect(settingsUtils.fieldType(factory, "custom")("field", { extra: 1 })).toEqual({
    name: "field",
    type: "custom",
    extra: 1
  });
  expect(factory).toHaveBeenCalledExactlyOnceWith("field", { type: "custom", extra: 1 });
});

test("settings runtime fields handle exact present and absent controller states", () => {
  const setStation = vi.fn();
  const station = settingsUtils.radioField("stationId");
  expect(station.getValue({ radio: { stationId: "one" } })).toBe("one");
  expect(station.getValue({})).toBeUndefined();
  expect(station.setValue({}, "two")).toBeUndefined();
  expect(station.setValue({ radio: {} }, "two")).toBeUndefined();
  station.setValue({ radio: { setStation } }, "two");
  expect(setStation).toHaveBeenCalledExactlyOnceWith("two");

  const updateBackend = vi.fn();
  const slider = settingsUtils.audioSlider("volume");
  expect(slider).toMatchObject({ name: "volume", span: 6, type: "slider" });
  expect(slider.getValue({ audio: {} })).toBeUndefined();
  expect(slider.getValue({ audio: { values: { volume: 0.4 } } })).toBe(0.4);
  slider.setValue({ audio: { updateBackend } }, 0.7);
  expect(updateBackend).toHaveBeenCalledExactlyOnceWith({ volume: 0.7 });

  const updatePreference = vi.fn();
  const preference = settingsUtils.preferenceSelect(
    "monitorInputDeviceId",
    [{ value: "default" }],
    { span: 12 }
  );
  expect(preference).toMatchObject({
    name: "monitorInputDeviceId",
    span: 12,
    type: "select",
    options: [{ value: "default" }]
  });
  expect(preference.getValue({ audio: {} })).toBeUndefined();
  expect(preference.getValue({ audio: { preferences: { monitorInputDeviceId: "default" } } })).toBe(
    "default"
  );
  preference.setValue({ audio: { updatePreference } }, "mic");
  expect(updatePreference).toHaveBeenCalledExactlyOnceWith("monitorInputDeviceId", "mic");

  const dynamic = settingsUtils.audioSelect("device", "devices");
  expect(dynamic.type).toBe("select");
  expect(dynamic.getOptions({ audio: {} })).toEqual([]);
  expect(dynamic.getOptions({ audio: { options: { devices: [{ value: "mic" }] } } })).toEqual([
    { value: "mic" }
  ]);
});

test("settings predicates distinguish every controller state", () => {
  expect(settingsUtils.monitorDisabled({ audio: {} })).toBe(false);
  expect(settingsUtils.monitorDisabled({ audio: { states: {} } })).toBe(false);
  expect(settingsUtils.monitorDisabled({ audio: { states: { monitoringEnabled: true } } })).toBe(
    true
  );
  expect(settingsUtils.audioDriverVisible({ audio: {} })).toBe(false);
  expect(settingsUtils.audioDriverVisible({ audio: { values: {} } })).toBe(false);
  expect(settingsUtils.audioDriverVisible({ audio: { values: { audio_driver: "asio" } } })).toBe(
    true
  );
  expect(settingsUtils.audioDriverVisible({ audio: { values: { audio_driver: "wasapi" } } })).toBe(
    false
  );
  expect(settingsUtils.multipleAudioDriversAvailable({ audio: {} })).toBe(false);
  expect(settingsUtils.multipleAudioDriversAvailable({ audio: { options: {} } })).toBe(false);
  expect(
    settingsUtils.multipleAudioDriversAvailable({ audio: { options: { audioDrivers: ["one"] } } })
  ).toBe(false);
  expect(
    settingsUtils.multipleAudioDriversAvailable({
      audio: { options: { audioDrivers: ["one", "two"] } }
    })
  ).toBe(true);
  expect(settingsUtils.speakerPlaying({ audio: {} })).toBe(false);
  expect(settingsUtils.speakerPlaying({ audio: { states: {} } })).toBe(false);
  expect(settingsUtils.speakerPlaying({ audio: { states: { speakerTestState: "playing" } } })).toBe(
    true
  );
  expect(settingsUtils.speakerPlaying({ audio: { states: { speakerTestState: "idle" } } })).toBe(
    false
  );
});

test("service-screen configuration has an exact static and runtime contract", () => {
  expect(digest(screenConfigs)).toBe(
    "35a0dd48fd43f00c939cc56daf24c8326d3d1b7ba6747f9bf9c4a82f3ec8aa52"
  );
  expect(screenConfigs.diagnostics.PIPELINE_CHECKS).toEqual([
    "ai_dir_found",
    "ffmpeg_available",
    "whisper_available",
    "demucs_available",
    "cuda_available",
    "torch_available"
  ]);
  expect(Object.keys(screenConfigs.diagnostics.STATUS_ICONS)).toEqual(["success", "error"]);
  expect(screenConfigs.history.HISTORY_COLUMNS).toEqual([
    "song",
    "action",
    "status",
    "duration",
    "date"
  ]);
  expect([...screenConfigs.history.HISTORY_ACTIONS]).toEqual(["processing", "recording"]);
  expect([...screenConfigs.history.RECORDING_STATUSES]).toEqual(["analyzed", "recorded"]);

  const { MEMORY_ACTIONS: actions } = screenConfigs.memory;
  expect(actions[0][4]).toBe(runtimeApi.clearCache);
  expect(actions[1][4]).toBe(runtimeApi.deleteTemp);
  expect(actions[0][5]({ freed_bytes: 1024 ** 2 })).toBe(
    translateSaved("Освобождено: {0}", { 0: translateSaved("{0} МБ", { 0: "1.0" }) })
  );
  expect(actions[1][5]({ freed_bytes: 2 * 1024 ** 2 })).toBe(
    translateSaved("Удалено временных файлов: {0}", { 0: translateSaved("{0} МБ", { 0: "2.0" }) })
  );

  expect(
    screenConfigs.memory.buildOptimizeOptions([
      { id: "ready", title: "Ready", status: "done" },
      { id: "optimized", title: "Optimized", status: "done", optimized: true },
      { id: "pending", title: "Pending", status: "pending" }
    ])
  ).toEqual([screenConfigs.memory.DEFAULT_OPTIMIZE_OPTION, { value: "ready", label: "Ready" }]);
  expect(screenConfigs.memory.buildOptimizeOptions()).toEqual([
    screenConfigs.memory.DEFAULT_OPTIMIZE_OPTION
  ]);
});
