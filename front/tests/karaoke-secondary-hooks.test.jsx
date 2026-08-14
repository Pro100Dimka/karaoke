/* @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateUiPreferences: vi.fn(),
  loadKaraokePreferences: vi.fn(),
  saveKaraokePreferences: vi.fn(),
  shuffleThemes: vi.fn(),
  createPanoramaPath: vi.fn(),
  getPanoramaPosition: vi.fn()
}));
vi.mock("../src/api/client", () => ({
  api: { updateUiPreferences: mocks.updateUiPreferences }
}));
vi.mock("../src/pages/Karaoke/utils/preferences", () => ({
  loadKaraokePreferences: mocks.loadKaraokePreferences,
  saveKaraokePreferences: mocks.saveKaraokePreferences
}));
vi.mock("../src/assets/karaoke/themes", () => ({
  KARAOKE_THEMES: [{ id: "fallback" }],
  shuffleThemes: mocks.shuffleThemes
}));
vi.mock("../src/pages/Karaoke/utils/data", () => ({
  createPanoramaPath: mocks.createPanoramaPath
}));
vi.mock("../src/pages/Karaoke/utils/panorama", () => ({
  getPanoramaPosition: mocks.getPanoramaPosition
}));

import useKaraokePanorama from "../src/pages/Karaoke/hooks/useKaraokePanorama.js";
import useKaraokePreferences from "../src/pages/Karaoke/hooks/useKaraokePreferences.js";
import useMelodyGuide from "../src/pages/Karaoke/hooks/useMelodyGuide.js";

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.loadKaraokePreferences.mockReturnValue({});
  mocks.saveKaraokePreferences.mockImplementation((value) => value);
  mocks.updateUiPreferences.mockResolvedValue({});
  mocks.shuffleThemes.mockReturnValue([{ id: "two" }, { id: "one" }]);
  mocks.createPanoramaPath.mockReturnValue([1, 2, 3]);
  mocks.getPanoramaPosition.mockReturnValue({ x: 12.3456, y: 67.891 });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete globalThis.AudioContext;
  delete globalThis.webkitAudioContext;
  delete document.documentElement.dataset.performance;
});

describe("karaoke preferences", () => {
  test("loads defaults and persists every preference change", async () => {
    const { result } = renderHook(() => useKaraokePreferences());
    expect(result.current).toMatchObject({
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
    act(() => {
      result.current.setMusicVolume(0.5);
      result.current.setVocalVolume(0.4);
      result.current.setMelodyVolume(0.3);
      result.current.setSpeed(1.2);
      result.current.setKeyShift(2);
      result.current.setShowLyrics(false);
      result.current.setShowNotes(false);
      result.current.setAutoHideConsole(false);
      result.current.setEffectPreset("hall");
    });
    await act(async () => Promise.resolve());
    expect(mocks.saveKaraokePreferences).toHaveBeenLastCalledWith({
      musicVolume: 0.5,
      vocalVolume: 0.4,
      melodyVolume: 0.3,
      speed: 1.2,
      keyShift: 2,
      showLyrics: false,
      showNotes: false,
      autoHideConsole: false,
      effectPreset: "hall"
    });
    expect(mocks.updateUiPreferences).toHaveBeenLastCalledWith(
      "karaoke",
      expect.objectContaining({ effectPreset: "hall" })
    );
  });

  test("uses saved values and skips remote persistence when local save fails", () => {
    mocks.loadKaraokePreferences.mockReturnValue({
      musicVolume: 0,
      vocalVolume: 0,
      melodyVolume: 1,
      speed: 0.8,
      keyShift: -2,
      showLyrics: false,
      showNotes: false,
      autoHideConsole: false,
      effectPreset: "dry"
    });
    mocks.saveKaraokePreferences.mockReturnValue(null);
    const { result } = renderHook(() => useKaraokePreferences());
    expect(result.current.musicVolume).toBe(0);
    expect(result.current.effectPreset).toBe("dry");
    expect(mocks.updateUiPreferences).not.toHaveBeenCalled();
  });

  test("ignores optional remote preference persistence failures", async () => {
    mocks.updateUiPreferences.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useKaraokePreferences());
    act(() => result.current.setSpeed(1.1));
    await act(async () => Promise.resolve());
    expect(mocks.updateUiPreferences).toHaveBeenCalled();
  });
});

describe("karaoke panorama", () => {
  test("cycles themes for songs and animates the panorama", () => {
    const frames = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback) => {
        frames.push(callback);
        return frames.length;
      })
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(performance, "now").mockReturnValue(100);
    const hook = renderHook(
      ({ songId, playing }) => useKaraokePanorama(songId, playing),
      { initialProps: { songId: "one", playing: false } }
    );
    expect(hook.result.current.activeTheme).toEqual({ id: "one" });
    const panorama = document.createElement("div");
    hook.result.current.panoramaRef.current = panorama;
    hook.rerender({ songId: "two", playing: true });
    expect(hook.result.current.activeTheme).toEqual({ id: "two" });
    act(() => frames.shift()(200));
    expect(panorama.style.getPropertyValue("--panorama-x")).toBe("-12.346cqh");
    expect(panorama.style.getPropertyValue("--panorama-y")).toBe("67.891%");
    hook.rerender({ songId: "two", playing: false });
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  test("throttles frames in reduced-performance mode and refills themes", () => {
    const frames = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback) => {
        frames.push(callback);
        return frames.length;
      })
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    document.documentElement.dataset.performance = "reduced";
    mocks.shuffleThemes
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ id: "refilled" }]);
    const hook = renderHook(
      ({ songId, playing }) => useKaraokePanorama(songId, playing),
      { initialProps: { songId: null, playing: false } }
    );
    expect(hook.result.current.activeTheme).toEqual({ id: "fallback" });
    const panorama = document.createElement("div");
    hook.result.current.panoramaRef.current = panorama;
    hook.rerender({ songId: "song", playing: true });
    expect(hook.result.current.activeTheme).toEqual({ id: "refilled" });
    act(() => frames.shift()(10));
    expect(mocks.getPanoramaPosition).not.toHaveBeenCalled();
    act(() => frames.shift()(100));
    expect(mocks.getPanoramaPosition).toHaveBeenCalled();
  });
});

function installGuideContext({ resumeError, closeError } = {}) {
  const oscillator = {
    type: "",
    frequency: { setTargetAtTime: vi.fn() },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn()
  };
  const gain = {
    gain: {
      value: 0,
      setTargetAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
      setValueAtTime: vi.fn()
    },
    connect: vi.fn()
  };
  oscillator.connect.mockReturnValue(gain);
  gain.connect.mockReturnValue(gain);
  const context = {
    state: "suspended",
    currentTime: 3,
    destination: {},
    createOscillator: () => oscillator,
    createGain: () => gain,
    resume: vi.fn(() =>
      resumeError ? Promise.reject(resumeError) : Promise.resolve()
    ),
    close: vi.fn(() =>
      closeError ? Promise.reject(closeError) : Promise.resolve()
    )
  };
  globalThis.AudioContext = class {
    constructor() {
      return context;
    }
  };
  return { context, oscillator, gain };
}

describe("melody guide", () => {
  test("starts, updates, silences and disposes its oscillator", async () => {
    const audio = installGuideContext();
    const currentTimeRef = { current: 1 };
    const hook = renderHook((props) => useMelodyGuide(props), {
      initialProps: {
        notes: [{ start: 0, end: 2, midi: 69 }],
        volume: 0.5,
        keyShift: 0,
        currentTimeRef
      }
    });
    await expect(hook.result.current.startMelodyGuide()).resolves.toBe(true);
    await expect(hook.result.current.startMelodyGuide()).resolves.toBe(true);
    expect(audio.oscillator.start).toHaveBeenCalledOnce();
    expect(audio.oscillator.frequency.setTargetAtTime).toHaveBeenCalled();
    act(() => hook.result.current.updateMelodyGuide(5));
    act(() => hook.result.current.silenceMelodyGuide());
    expect(audio.gain.gain.cancelScheduledValues).toHaveBeenCalledWith(3);
    hook.unmount();
    expect(audio.oscillator.stop).toHaveBeenCalled();
    expect(audio.context.close).toHaveBeenCalled();
  });

  test("rejects missing inputs and cleans a guide whose resume fails", async () => {
      const empty = renderHook(() =>
      useMelodyGuide({
        notes: [],
        volume: 1,
        keyShift: 0,
        currentTimeRef: { current: 0 }
      })
      );
      act(() => empty.result.current.updateMelodyGuide(0));
      act(() => empty.result.current.silenceMelodyGuide());
      expect(await empty.result.current.startMelodyGuide()).toBe(false);
      empty.unmount();

      const unavailable = renderHook(() =>
        useMelodyGuide({
          notes: [{ start: 0, end: 1, midi: 60 }],
          volume: 1,
          keyShift: 0,
          currentTimeRef: { current: 0 }
        })
      );
      expect(await unavailable.result.current.startMelodyGuide()).toBe(false);
      unavailable.unmount();

      const failure = new Error("resume failed");
    const audio = installGuideContext({
      resumeError: failure,
      closeError: new Error("already closed")
    });
    const failed = renderHook(() =>
      useMelodyGuide({
        notes: [{ start: 0, end: 1, midi: 60 }],
        volume: 1,
        keyShift: 0,
        currentTimeRef: { current: 0 }
      })
    );
    await expect(failed.result.current.startMelodyGuide()).rejects.toThrow(
      "resume failed"
    );
    expect(audio.oscillator.stop).toHaveBeenCalled();
    expect(audio.context.close).toHaveBeenCalled();
  });

  test("ignores an asynchronous close failure during disposal", async () => {
    const audio = installGuideContext({
      closeError: new Error("already closed")
    });
    const hook = renderHook(() =>
      useMelodyGuide({
        notes: [{ start: 0, end: 1, midi: 60 }],
        volume: 1,
        keyShift: 0,
        currentTimeRef: { current: 0 }
      })
    );
    await hook.result.current.startMelodyGuide();
    hook.unmount();
    await act(async () => Promise.resolve());
    expect(audio.context.close).toHaveBeenCalled();
  });

  test("does not restore a guide disposed during a failed resume", async () => {
    let rejectResume;
    const audio = installGuideContext();
    audio.context.resume.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectResume = reject;
      })
    );
    const hook = renderHook(() =>
      useMelodyGuide({
        notes: [{ start: 0, end: 1, midi: 60 }],
        volume: 1,
        keyShift: 0,
        currentTimeRef: { current: 0 }
      })
    );
    const start = hook.result.current.startMelodyGuide();
    hook.unmount();
    rejectResume(new Error("disposed"));
    await expect(start).rejects.toThrow("disposed");
  });
});
