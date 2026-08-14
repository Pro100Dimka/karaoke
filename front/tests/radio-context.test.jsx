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
    cleanup();
    store({ stationId: "poptron", volume: "bad", enabled: false });
    const fallback = renderHook(() => useRadio(), { wrapper });
    expect(fallback.result.current.volume).toBe(0.45);
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

  test("animates startup volume and isolates preference persistence failures", async () => {
    const frames = [];
    globalThis.requestAnimationFrame = vi.fn((callback) => {
      frames.push(callback);
      return frames.length;
    });
    mocks.updateUiPreferences.mockRejectedValueOnce(new Error("storage"));
    const hook = renderHook(() => useRadio(), { wrapper });
    act(() => hook.result.current.setVolume(0.6));
    await act(async () => {
      expect(
        await hook.result.current.turnOn({ fadeIn: true, analyse: false })
      ).toBe(true);
    });
    const audio = document.querySelector("audio");
    act(() => frames.at(-1)(performance.now() + 100));
    act(() => frames.at(-1)(performance.now() + 3000));
    expect(audio.volume).toBeCloseTo(0.6);
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

    hook.result.current.turnOff({ remember: false });
    HTMLMediaElement.prototype.play.mockRejectedValueOnce(
      new Error("user gesture required")
    );
    await act(async () => {
      expect(
        await hook.result.current.turnOn({ fadeIn: true, remember: false })
      ).toBe(false);
    });
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
      close: vi.fn().mockRejectedValue(new Error("close failed"))
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
    await act(() => hook.result.current.turnOn({ analyse: true }));
    act(() => hook.result.current.turnOff({ remember: false }));
    expect(
      document.documentElement.style.getPropertyValue("--radio-analysis-active")
    ).toBe("0");
    hook.unmount();
    expect(context.close).toHaveBeenCalled();
  });

  test("handles a silent fade and a fade interrupted by pause", async () => {
    const frames = [];
    globalThis.requestAnimationFrame = vi.fn((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const hook = renderHook(() => useRadio(), { wrapper });
    act(() => hook.result.current.setVolume(0));
    await act(() => hook.result.current.turnOn({ fadeIn: true }));
    const audio = document.querySelector("audio");
    expect(audio.volume).toBe(0);
    act(() => hook.result.current.setVolume(0.5));
    await act(() => hook.result.current.turnOn({ fadeIn: true }));
    audio.pause();
    act(() => frames.at(-1)(performance.now() + 100));
    expect(audio.paused).toBe(true);
  });

  test("stops analysis after a browser analyser failure", async () => {
    const analyser = {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 32,
      connect: vi.fn(),
      getByteFrequencyData: vi.fn(() => {
        throw new Error("device removed");
      })
    };
    window.AudioContext = class {
      state = "running";
      sampleRate = 48000;
      destination = {};
      createAnalyser = () => analyser;
      createMediaElementSource = () => ({ connect: vi.fn() });
      resume = vi.fn();
      close = vi.fn().mockResolvedValue();
    };
    const hook = renderHook(() => useRadio(), { wrapper });
    await act(() => hook.result.current.turnOn({ analyse: true }));
    expect(
      document.documentElement.style.getPropertyValue("--radio-analysis-active")
    ).toBe("0");
  });

  test("cancels a pending playback and reports the final media-stream error", async () => {
    let resolvePlay;
    HTMLMediaElement.prototype.play.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePlay = resolve;
        })
    );
    const hook = renderHook(() => useRadio(), { wrapper });
    const pending = hook.result.current.turnOn();
    fireEvent.error(document.querySelector("audio"));
    expect(hook.result.current.error).toBe("");
    act(() => hook.result.current.turnOff({ remember: false }));
    resolvePlay();
    await expect(pending).resolves.toBe(false);

    HTMLMediaElement.prototype.play.mockResolvedValue(undefined);
    await act(() => hook.result.current.turnOn());
    fireEvent.error(document.querySelector("audio"));
    await act(async () => Promise.resolve());
    fireEvent.error(document.querySelector("audio"));
    await act(async () => Promise.resolve());
    expect(hook.result.current.error).not.toBe("");
  });

  test("reports a generic error when media rejects without a reason", async () => {
    const immediate = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((callback) => {
        callback();
        return 1;
      });
    HTMLMediaElement.prototype.play.mockRejectedValue(undefined);
    const hook = renderHook(() => useRadio(), { wrapper });
    await act(async () => {
      expect(await hook.result.current.turnOn()).toBe(false);
    });
    expect(hook.result.current.error).not.toBe("");
    immediate.mockRestore();
  });

  test("recognizes message-only autoplay blocks and reasonless objects", async () => {
    HTMLMediaElement.prototype.play.mockRejectedValueOnce(
      new Error("user gesture is required")
    );
    const blocked = renderHook(() => useRadio(), { wrapper });
    await act(async () => {
      expect(await blocked.result.current.turnOn({ fadeIn: true })).toBe(false);
    });
    blocked.unmount();

    const immediate = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((callback) => {
        callback();
        return 1;
      });
    HTMLMediaElement.prototype.play.mockRejectedValue({});
    const reasonless = renderHook(() => useRadio(), { wrapper });
    await act(async () => {
      expect(await reasonless.result.current.turnOn()).toBe(false);
    });
    expect(reasonless.result.current.error).not.toBe("");
    immediate.mockRestore();

    HTMLMediaElement.prototype.play.mockRejectedValueOnce(
      "user gesture is required"
    );
    const stringReason = renderHook(() => useRadio(), { wrapper });
    await act(async () => {
      expect(
        await stringReason.result.current.turnOn({ fadeIn: true })
      ).toBe(false);
    });
    stringReason.unmount();

    const immediateNull = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((callback) => {
        callback();
        return 1;
      });
    HTMLMediaElement.prototype.play.mockRejectedValue(null);
    const nullReason = renderHook(() => useRadio(), { wrapper });
    await act(async () => {
      expect(
        await nullReason.result.current.turnOn({ fadeIn: true })
      ).toBe(false);
    });
    immediateNull.mockRestore();
  });

  test("unlocks a paused analyser and applies its decay response", async () => {
    const frames = [];
    globalThis.requestAnimationFrame = vi.fn((callback) => {
      frames.push(callback);
      return frames.length;
    });
    let high = true;
    const analyser = {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 32,
      connect: vi.fn(),
      getByteFrequencyData: vi.fn((data) => data.fill(high ? 220 : 0))
    };
    window.AudioContext = class {
      state = "running";
      sampleRate = 48000;
      destination = {};
      createAnalyser = () => analyser;
      createMediaElementSource = () => ({ connect: vi.fn() });
      resume = vi.fn();
      close = vi.fn().mockResolvedValue();
    };
    const hook = renderHook(() => useRadio(), { wrapper });
    window.dispatchEvent(new Event("pointerdown"));
    await act(async () => Promise.resolve());
    expect(analyser.getByteFrequencyData).not.toHaveBeenCalled();
    await act(() => hook.result.current.turnOn({ analyse: true }));
    const attack = hook.result.current.getBassLevel();
    high = false;
    act(() => frames.shift()(performance.now()));
    expect(hook.result.current.getBassLevel()).toBeLessThan(attack);
  });

  test("switches stations and recording suspension while stopped", () => {
    const hook = renderHook(() => useRadio(), { wrapper });
    act(() => hook.result.current.setStation("indiepop"));
    expect(hook.result.current.stationId).toBe("indiepop");
    act(() => hook.result.current.setRecordingActive(true));
    act(() => hook.result.current.setRecordingActive(false));
    expect(hook.result.current.isPlaying).toBe(false);
  });

  test("ignores late blocked and failed playback after unmount", async () => {
    let rejectBlocked;
    HTMLMediaElement.prototype.play.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectBlocked = reject;
      })
    );
    const blockedHook = renderHook(() => useRadio(), { wrapper });
    const blockedPlayback = blockedHook.result.current.turnOn({ fadeIn: true });
    blockedHook.unmount();
    const blocked = new Error("gesture required");
    blocked.name = "NotAllowedError";
    rejectBlocked(blocked);
    await expect(blockedPlayback).resolves.toBe(false);

    let rejectFailed;
    HTMLMediaElement.prototype.play.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectFailed = reject;
      })
    );
    const failedHook = renderHook(() => useRadio(), { wrapper });
    const failedPlayback = failedHook.result.current.turnOn();
    failedHook.unmount();
    rejectFailed(new Error("late"));
    await expect(failedPlayback).resolves.toBe(false);
  });

  test("cancels an older playback before it tries another mirror", async () => {
    let rejectFirst;
    HTMLMediaElement.prototype.play
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject;
          })
      )
      .mockResolvedValue(undefined);
    const hook = renderHook(() => useRadio(), { wrapper });
    const older = hook.result.current.turnOn();
    const newer = hook.result.current.turnOn();
    await expect(newer).resolves.toBe(true);
    rejectFirst(new Error("old mirror"));
    await expect(older).resolves.toBe(false);
  });

  test("ignores an analyser frame after analysis has stopped", async () => {
    const frames = [];
    globalThis.requestAnimationFrame = vi.fn((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const analyser = {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 32,
      connect: vi.fn(),
      getByteFrequencyData: vi.fn((data) => data.fill(100))
    };
    window.AudioContext = class {
      state = "running";
      sampleRate = 48000;
      destination = {};
      createAnalyser = () => analyser;
      createMediaElementSource = () => ({ connect: vi.fn() });
      resume = vi.fn();
      close = vi.fn().mockResolvedValue();
    };
    const hook = renderHook(() => useRadio(), { wrapper });
    await act(() => hook.result.current.turnOn({ analyse: true }));
    const staleFrame = frames.at(-1);
    act(() => hook.result.current.turnOff({ remember: false }));
    act(() => staleFrame(performance.now()));
    expect(analyser.getByteFrequencyData).toHaveBeenCalledTimes(1);
  });

  test("retries startup autoplay on the first user gesture", async () => {
    store({ stationId: "poptron", volume: 0.45, enabled: true });
    const blocked = new Error("gesture required");
    blocked.name = "NotAllowedError";
    HTMLMediaElement.prototype.play
      .mockRejectedValueOnce(blocked)
      .mockResolvedValue(undefined);
    const hook = renderHook(() => useRadio(), { wrapper });
    await act(async () => Promise.resolve());
    window.dispatchEvent(new Event("pointerdown"));
    await act(async () => Promise.resolve());
    expect(hook.result.current.isPlaying).toBe(true);
  });
});
