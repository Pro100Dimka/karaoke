/* @vitest-environment jsdom */
import { afterEach, expect, test, vi } from "vitest";

import {
  EMPTY_BROWSER_DEVICES,
  FULL,
  LATENCY_OPTIONS,
  MONITOR_MODE_OPTIONS,
  SCREEN_BY_ID,
  SERVICE_SCREENS,
  SETTINGS,
  SETTINGS_TABS
} from "../src/pages/Settings/config.jsx";

afterEach(() => {
  delete globalThis.electronAPI;
});

const field = (section, name) =>
  SETTINGS[section].fields.find((item) => item.name === name);

test("settings catalog exposes stable tabs, screens and options", () => {
  expect(FULL).toBe(12);
  expect(SETTINGS_TABS.map(({ id }) => id)).toEqual([
    "appearance",
    "audio",
    "ai"
  ]);
  expect(LATENCY_OPTIONS.map(({ value }) => value)).toEqual([
    "interactive",
    "balanced",
    "playback"
  ]);
  expect(MONITOR_MODE_OPTIONS.length).toBeGreaterThan(0);
  expect(SERVICE_SCREENS.every(({ id }) => SCREEN_BY_ID[id])).toBe(true);
  expect(EMPTY_BROWSER_DEVICES).toEqual({ inputs: [], outputs: [] });
  expect(Object.isFrozen(EMPTY_BROWSER_DEVICES)).toBe(true);
});

test("radio and storage fields resolve runtime choices", async () => {
  const station = field("appearance", "stationId");
  expect(station.getOptions({ radio: null })).toEqual([]);
  expect(
    station.getOptions({
      radio: {
        stations: [{ id: "one", name: "One", description: "Music" }]
      }
    })
  ).toEqual([{ value: "one", label: "One", description: "Music" }]);
  expect(field("appearance", "volume").getLabel({ value: 0.42 })).toContain(
    "42"
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
});
