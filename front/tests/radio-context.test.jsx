/* @vitest-environment jsdom */
import React from "react";
import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ updateUiPreferences: vi.fn() }));
vi.mock("../src/api/client", () => ({ api: mocks }));

import {
  RADIO_STATIONS,
  RadioProvider,
  useRadio
} from "../src/contexts/radio.jsx";

const wrapper = ({ children }) => <RadioProvider>{children}</RadioProvider>;
const store = (value) =>
  localStorage.setItem("karaoke-radio", JSON.stringify(value));

beforeEach(() => {
  localStorage.clear();
  store({ stationId: "poptron", volume: 0.45, enabled: false });
  mocks.updateUiPreferences.mockReset().mockResolvedValue({});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
    function pause() {
      Object.defineProperty(this, "paused", {
        configurable: true,
        value: true
      });
    }
  );
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(
    function play() {
      Object.defineProperty(this, "paused", {
        configurable: true,
        value: false
      });
      return Promise.resolve();
    }
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1)
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("--radio-bass");
  document.documentElement.style.removeProperty("--radio-analysis-active");
  for (let index = 0; index < 18; index += 1)
    document.documentElement.style.removeProperty(`--radio-band-${index}`);
  delete window.AudioContext;
  delete window.webkitAudioContext;
});

describe("radio context", () => {
  test("requires the provider", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const suppress = (event) => event.preventDefault();
    window.addEventListener("error", suppress);
    expect(() => renderHook(() => useRadio())).toThrow(
      "useRadio must be used inside RadioProvider"
    );
    window.removeEventListener("error", suppress);
    log.mockRestore();
  });

  test("normalizes stored settings and exposes station metadata", () => {
    store({ stationId: "unknown", volume: 8, enabled: "yes" });
    const { result } = renderHook(() => useRadio(), { wrapper });
    expect(result.current.stationId).toBe("poptron");
    expect(result.current.volume).toBe(1);
    expect(result.current.stations).toBe(RADIO_STATIONS);
    expect(result.current.getBassLevel()).toBe(0);
    expect(result.current.getSpectrumLevels()).toHaveLength(18);
  });

  test("starts, stops, toggles and persists playback", async () => {
    const hook = renderHook(() => useRadio(), { wrapper });
    await act(async () => {
      expect(await hook.result.current.turnOn()).toBe(true);
    });
    expect(hook.result.current.isPlaying).toBe(true);
    expect(document.querySelector("audio").src).toContain("poptron");
    expect(mocks.updateUiPreferences).toHaveBeenCalledWith(
      "radio",
      expect.objectContaining({ enabled: true })
    );
    act(() => hook.result.current.toggle());
    expect(hook.result.current.isPlaying).toBe(false);
    act(() => hook.result.current.toggle());
    await act(async () => Promise.resolve());
    expect(hook.result.current.isPlaying).toBe(true);
  });

  test("clamps volume and switches valid stations", async () => {
    const hook = renderHook(() => useRadio(), { wrapper });
    act(() => hook.result.current.setVolume(4));
    expect(hook.result.current.volume).toBe(1);
    act(() => hook.result.current.setVolume("bad"));
    expect(hook.result.current.volume).toBe(0.45);
    act(() => hook.result.current.setStation("unknown"));
    expect(hook.result.current.stationId).toBe("poptron");

    await act(() => hook.result.current.turnOn());
    act(() => hook.result.current.setStation("indiepop"));
    await act(async () => Promise.resolve());
    expect(hook.result.current.stationId).toBe("indiepop");
    expect(document.querySelector("audio").src).toContain("indiepop");
  });

  test("suspends radio while recording and resumes afterwards", async () => {
    const hook = renderHook(() => useRadio(), { wrapper });
    await act(() => hook.result.current.turnOn());
    act(() => hook.result.current.setRecordingActive(true));
    expect(hook.result.current.isPlaying).toBe(false);
    await act(async () => {
      expect(await hook.result.current.turnOn()).toBe(false);
    });
    act(() => hook.result.current.setRecordingActive(false));
    await act(async () => Promise.resolve());
    expect(hook.result.current.isPlaying).toBe(true);
    act(() => hook.result.current.setRecordingActive(false));
  });

  test("tries mirror streams and handles blocked startup autoplay", async () => {
    HTMLMediaElement.prototype.play
      .mockRejectedValueOnce(new Error("first mirror failed"))
      .mockResolvedValueOnce(undefined);
    const hook = renderHook(() => useRadio(), { wrapper });
    await act(async () => {
      expect(await hook.result.current.turnOn()).toBe(true);
    });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);

    hook.result.current.turnOff({ remember: false });
    const blocked = new Error("user gesture is required");
    blocked.name = "NotAllowedError";
    HTMLMediaElement.prototype.play.mockRejectedValueOnce(blocked);
    await act(async () => {
      expect(
        await hook.result.current.turnOn({ fadeIn: true, remember: false })
      ).toBe(false);
    });
    expect(hook.result.current.error).toBe("");
    window.dispatchEvent(new Event("pointerdown"));
    await act(async () => Promise.resolve());
  });

  test("reports exhausted streams and recovers from media errors", async () => {
    const immediate = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((callback) => {
        callback();
        return 1;
      });
    HTMLMediaElement.prototype.play.mockRejectedValue(new Error("offline"));
    const hook = renderHook(() => useRadio(), { wrapper });
    await act(async () => {
      expect(await hook.result.current.turnOn()).toBe(false);
    });
    expect(hook.result.current.error).toContain("offline");
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(4);
    immediate.mockRestore();

    HTMLMediaElement.prototype.play.mockResolvedValue(undefined);
    await act(() => hook.result.current.turnOn());
    HTMLMediaElement.prototype.play.mockClear();
    await act(async () => fireEvent.error(document.querySelector("audio")));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  test("builds an analyser graph and clears its visual state", async () => {
    const analyser = {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 32,
      connect: vi.fn(),
      getByteFrequencyData: vi.fn((data) => data.fill(200))
    };
    const context = {
      state: "suspended",
      sampleRate: 48000,
      destination: {},
      createAnalyser: () => analyser,
      createMediaElementSource: () => ({ connect: vi.fn() }),
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    };
    window.AudioContext = class {
      constructor() {
        return context;
      }
    };
    const hook = renderHook(() => useRadio(), { wrapper });
    await act(async () => {
      expect(await hook.result.current.turnOn({ analyse: true })).toBe(true);
    });
    expect(context.resume).toHaveBeenCalled();
    expect(analyser.getByteFrequencyData).toHaveBeenCalled();
    expect(hook.result.current.getBassLevel()).toBeGreaterThan(0);
    expect(
      document.documentElement.style.getPropertyValue("--radio-analysis-active")
    ).toBe("1");
    act(() => hook.result.current.turnOff({ remember: false }));
    expect(
      document.documentElement.style.getPropertyValue("--radio-analysis-active")
    ).toBe("0");
    hook.unmount();
    expect(context.close).toHaveBeenCalled();
  });
});
