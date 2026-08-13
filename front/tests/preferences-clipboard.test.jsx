/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  DEFAULT_AUDIO_PREFERENCES,
  getAudioPreferences,
  saveAudioPreferences
} from "../src/utils/audio-preferences.js";
import { copyText } from "../src/utils/clipboard.js";
import { APP_INFO } from "../src/utils/config.js";
import {
  hydrateUiPreferences,
  persistUiPreferences,
  UI_PREFERENCE_STORAGE
} from "../src/utils/ui-preferences.js";
import { formatBytes } from "../src/pages/Settings/screens/memory/format.js";
import {
  clamp,
  normalizePreset
} from "../src/pages/Karaoke/components/console/utils.js";

beforeEach(() => {
  localStorage.clear();
  delete window.electronAPI;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined
  });
  delete document.execCommand;
});
afterEach(() => vi.restoreAllMocks());

describe("audio and UI preferences", () => {
  test("normalizes persisted audio preferences", () => {
    expect(getAudioPreferences()).toEqual(DEFAULT_AUDIO_PREFERENCES);
    localStorage.setItem(
      "karaoke-audio-preferences",
      JSON.stringify({
        monitorInputDeviceId: "mic",
        monitorOutputDeviceId: "",
        monitorLatencyHint: "playback",
        monitorMode: "browser"
      })
    );
    expect(getAudioPreferences()).toEqual({
      monitorInputDeviceId: "mic",
      monitorOutputDeviceId: "default",
      monitorLatencyHint: "playback",
      monitorMode: "browser"
    });
  });

  test("saves validated audio preferences and emits a change event", () => {
    const changed = vi.fn();
    window.addEventListener("audio-preferences-changed", changed);
    const saved = saveAudioPreferences({
      monitorInputDeviceId: "usb",
      monitorLatencyHint: "invalid",
      monitorMode: "invalid"
    });
    expect(saved).toEqual({
      ...DEFAULT_AUDIO_PREFERENCES,
      monitorInputDeviceId: "usb"
    });
    expect(changed.mock.calls[0][0].detail).toEqual(saved);
    expect(
      JSON.parse(localStorage.getItem("karaoke-audio-preferences"))
    ).toEqual(saved);
    expect(saveAudioPreferences(null)).toEqual(saved);
    window.removeEventListener("audio-preferences-changed", changed);
  });

  test("hydrates remote values and uploads local-only values", async () => {
    localStorage.setItem(
      UI_PREFERENCE_STORAGE.karaoke,
      JSON.stringify({ volume: 0.7 })
    );
    const api = {
      getUiPreferences: vi.fn().mockResolvedValue({
        audio: { monitorMode: "browser" },
        karaoke: null,
        radio: []
      }),
      updateUiPreferences: vi.fn().mockResolvedValue({})
    };
    await hydrateUiPreferences(api);
    expect(
      JSON.parse(localStorage.getItem(UI_PREFERENCE_STORAGE.audio))
    ).toEqual({ monitorMode: "browser" });
    expect(api.updateUiPreferences).toHaveBeenCalledWith("karaoke", {
      volume: 0.7
    });
  });

  test("persists known namespaces and still sends unknown ones", async () => {
    const api = {
      updateUiPreferences: vi.fn().mockRejectedValue(new Error("optional"))
    };
    expect(persistUiPreferences(api, "settings", { tab: "audio" })).toEqual({
      tab: "audio"
    });
    expect(
      JSON.parse(localStorage.getItem(UI_PREFERENCE_STORAGE.settings))
    ).toEqual({ tab: "audio" });
    persistUiPreferences(api, "future", { enabled: true });
    await Promise.resolve();
    expect(api.updateUiPreferences).toHaveBeenCalledTimes(2);
  });
});

describe("clipboard fallbacks", () => {
  test("rejects empty values and prefers Electron", async () => {
    expect(await copyText(null)).toBe(false);
    window.electronAPI = { copyText: vi.fn().mockResolvedValue(1) };
    expect(await copyText(42)).toBe(true);
    expect(window.electronAPI.copyText).toHaveBeenCalledWith("42");
  });

  test("falls back from Electron to the browser clipboard", async () => {
    window.electronAPI = {
      copyText: vi.fn().mockRejectedValue(new Error("ipc unavailable"))
    };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    expect(await copyText("text")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("text");
  });

  test("uses and cleans up the legacy textarea fallback", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }
    });
    document.execCommand = vi.fn(() => true);
    expect(await copyText("legacy")).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();

    document.execCommand.mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(await copyText("blocked")).toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });
});

describe("small formatting contracts", () => {
  test("keeps application identity and formats memory", () => {
    expect(APP_INFO.title).toBe("A&D Voice");
    expect(APP_INFO.copyright).toContain("2026");
    expect(formatBytes(1024 ** 2)).toContain("1.0");
    expect(formatBytes(-1)).toContain("0.0");
    expect(formatBytes("invalid")).toContain("0.0");
  });

  test("normalizes console presets and clamps values", () => {
    expect(clamp(12, 0, 10)).toBe(10);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(normalizePreset([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5, 0]);
    expect(
      normalizePreset({
        id: 1,
        label: 2,
        symbol: 3,
        echo: 4,
        reverb: 5,
        delay: 6
      })
    ).toEqual([1, 2, 3, 4, 5, 6]);
    expect(normalizePreset(null)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      0
    ]);
  });
});
