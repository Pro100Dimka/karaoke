/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { formatBytes } from "../src/pages/Settings/screens/memory/format.js";
import {
  clamp,
  normalizePreset
} from "../src/pages/Karaoke/components/console/utils.js";

let importId = 0;
const importUtility = (name) =>
  import(/* @vite-ignore */ `../src/utils/${name}.js?contract=${importId++}`);

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
    return importUtility("audio-preferences").then(
      ({ DEFAULT_AUDIO_PREFERENCES, getAudioPreferences }) => {
        expect(DEFAULT_AUDIO_PREFERENCES).toEqual({
          monitorInputDeviceId: "default",
          monitorOutputDeviceId: "default",
          monitorLatencyHint: "interactive",
          monitorMode: "direct"
        });
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
        localStorage.setItem(
          "karaoke-audio-preferences",
          JSON.stringify({
            monitorInputDeviceId: "   ",
            monitorOutputDeviceId: 42,
            monitorLatencyHint: "balanced",
            monitorMode: "direct"
          })
        );
        expect(getAudioPreferences()).toEqual({
          monitorInputDeviceId: "default",
          monitorOutputDeviceId: "default",
          monitorLatencyHint: "balanced",
          monitorMode: "direct"
        });
      }
    );
  });

  test("saves validated audio preferences and emits a change event", async () => {
    const { DEFAULT_AUDIO_PREFERENCES, saveAudioPreferences } =
      await importUtility("audio-preferences");
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
    localStorage.setItem(
      "karaoke-audio-preferences",
      JSON.stringify({ monitorLatencyHint: "playback", monitorMode: "browser" })
    );
    expect(
      saveAudioPreferences({
        monitorLatencyHint: "interactive",
        monitorMode: "direct"
      })
    ).toMatchObject({
      monitorLatencyHint: "interactive",
      monitorMode: "direct"
    });
    const callablePatch = () => {};
    callablePatch.monitorMode = "browser";
    expect(saveAudioPreferences(callablePatch).monitorMode).toBe("direct");
    window.removeEventListener("audio-preferences-changed", changed);
  });

  test("hydrates remote values and uploads local-only values", async () => {
    const { hydrateUiPreferences, UI_PREFERENCE_STORAGE } =
      await importUtility("ui-preferences");
    expect(UI_PREFERENCE_STORAGE).toEqual({
      audio: "karaoke-audio-preferences",
      karaoke: "karaoke-player-preferences",
      melody_editor: "karaoke-melody-editor",
      radio: "karaoke-radio",
      settings: "karaoke-settings-view"
    });
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
    expect(api.updateUiPreferences).toHaveBeenCalledTimes(1);

    api.getUiPreferences.mockResolvedValueOnce(undefined);
    await expect(hydrateUiPreferences(api)).resolves.toBeUndefined();
    const callable = () => {};
    callable.invalid = true;
    api.getUiPreferences.mockResolvedValueOnce({ audio: callable });
    await hydrateUiPreferences(api);
    expect(
      JSON.parse(localStorage.getItem(UI_PREFERENCE_STORAGE.audio))
    ).toEqual({
      monitorMode: "browser"
    });
    api.getUiPreferences.mockResolvedValueOnce({ audio: "x" });
    await hydrateUiPreferences(api);
    expect(
      JSON.parse(localStorage.getItem(UI_PREFERENCE_STORAGE.audio))
    ).toEqual({ monitorMode: "browser" });
  });

  test("persists known namespaces and still sends unknown ones", async () => {
    const { persistUiPreferences, UI_PREFERENCE_STORAGE } =
      await importUtility("ui-preferences");
    const api = {
      updateUiPreferences: vi.fn().mockRejectedValue(new Error("optional"))
    };
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    expect(persistUiPreferences(api, "settings", { tab: "audio" })).toEqual({
      tab: "audio"
    });
    expect(
      JSON.parse(localStorage.getItem(UI_PREFERENCE_STORAGE.settings))
    ).toEqual({ tab: "audio" });
    persistUiPreferences(api, "future", { enabled: true });
    await Promise.resolve();
    expect(api.updateUiPreferences).toHaveBeenCalledTimes(2);
    expect(setItem).toHaveBeenCalledTimes(1);
  });
});

describe("clipboard fallbacks", () => {
  test("rejects empty values and prefers Electron", async () => {
    const { copyText } = await importUtility("clipboard");
    document.execCommand = vi.fn(() => true);
    expect(await copyText(null)).toBe(false);
    expect(document.execCommand).not.toHaveBeenCalled();
    window.electronAPI = { copyText: vi.fn().mockResolvedValue(1) };
    expect(await copyText(42)).toBe(true);
    expect(window.electronAPI.copyText).toHaveBeenCalledWith("42");
  });

  test("falls back from Electron to the browser clipboard", async () => {
    const { copyText } = await importUtility("clipboard");
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
    const { copyText } = await importUtility("clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }
    });
    const createElement = vi.spyOn(document, "createElement");
    document.execCommand = vi.fn(() => true);
    expect(await copyText("legacy")).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
    const textarea = createElement.mock.results.find(
      ({ value }) => value?.tagName === "TEXTAREA"
    ).value;
    expect(textarea.readOnly).toBe(true);
    expect(textarea.style.position).toBe("fixed");
    expect(textarea.style.opacity).toBe("0");
    expect(textarea.style.pointerEvents).toBe("none");

    document.execCommand.mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(await copyText("blocked")).toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });

  test("legacy clipboard fallback is unavailable without a document", async () => {
    const { copyText } = await importUtility("clipboard");
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: undefined
    });
    expect(await copyText("text")).toBe(false);
    Object.defineProperty(globalThis, "document", descriptor);
  });
});

describe("small formatting contracts", () => {
  test("keeps application identity and formats memory", () => {
    return importUtility("config").then(({ APP_INFO }) => {
      expect(APP_INFO).toEqual({
        title: "A&D Voice",
        description: expect.stringContaining("AI"),
        copyright: "© 2026 A&D Voice"
      });
      expect(formatBytes(1024 ** 2)).toContain("1.0");
      expect(formatBytes(0)).toContain("0.0");
      expect(formatBytes(-1)).toContain("0.0");
      expect(formatBytes("invalid")).toContain("0.0");
    });
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
