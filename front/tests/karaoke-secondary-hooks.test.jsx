/* @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { stubFrameQueue } from "./helpers/browser.mjs";
import { same, called, calledWith, verify } from "./helpers/assertions.mjs";
const mocks = vi.hoisted(() => ({
  updateUiPreferences: vi.fn(),
  loadKaraokePreferences: vi.fn(),
  saveKaraokePreferences: vi.fn(),
  shuffleThemes: vi.fn(),
  createPanoramaPath: vi.fn(),
  getPanoramaPosition: vi.fn()
}));
vi.mock("../src/api/client", () => ({ api: { updateUiPreferences: mocks.updateUiPreferences } }));
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
  mocks.saveKaraokePreferences.mockReturnValue(true);
  mocks.updateUiPreferences.mockResolvedValue({});
  mocks.shuffleThemes.mockImplementation(() => [{ id: "two" }, { id: "one" }]);
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
    verify([
      result.current,
      "toMatchObject",
      {
        musicVolume: 1,
        vocalVolume: 1,
        melodyVolume: 0,
        speed: 1,
        keyShift: 0,
        showLyrics: true,
        showNotes: true,
        autoHideConsole: true,
        effectPreset: "studio",
        timingOffsets: {}
      }
    ]);
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
      result.current.setTimingOffsets({ song: -3.1 });
    });
    await act(async () => Promise.resolve());
    verify([
      mocks.saveKaraokePreferences,
      "toHaveBeenLastCalledWith",
      {
        musicVolume: 0.5,
        vocalVolume: 0.4,
        melodyVolume: 0.3,
        speed: 1.2,
        keyShift: 2,
        showLyrics: false,
        showNotes: false,
        autoHideConsole: false,
        effectPreset: "hall",
        timingOffsets: { song: -3.1 }
      }
    ]);
    verify([
      mocks.updateUiPreferences,
      "toHaveBeenLastCalledWith",
      "karaoke",
      {
        musicVolume: 0.5,
        vocalVolume: 0.4,
        melodyVolume: 0.3,
        speed: 1.2,
        keyShift: 2,
        showLyrics: false,
        showNotes: false,
        autoHideConsole: false,
        effectPreset: "hall",
        timingOffsets: { song: -3.1 }
      }
    ]);
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
    mocks.saveKaraokePreferences.mockReturnValue(false);
    const { result } = renderHook(() => useKaraokePreferences());
    same([result.current.musicVolume, 0], [result.current.effectPreset, "dry"]);
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
    const frames = stubFrameQueue();
    vi.spyOn(performance, "now").mockReturnValue(100);
    const hook = renderHook(({ songId, playing }) => useKaraokePanorama(songId, playing), {
      initialProps: { songId: "one", playing: false }
    });
    expect(hook.result.current.activeTheme).toEqual({ id: "one" });
    const panorama = document.createElement("div");
    hook.result.current.panoramaRef.current = panorama;
    hook.rerender({ songId: "two", playing: true });
    verify([hook.result.current.activeTheme, "toEqual", { id: "two" }], [mocks.getPanoramaPosition, "not.toHaveBeenCalled"]);
    act(() => frames.shift()(10));
    verify([mocks.getPanoramaPosition, "toHaveBeenLastCalledWith", -90, 240_000, [1, 2, 3]]);
    act(() => frames.shift()(200));
    same([panorama.style.getPropertyValue("--panorama-x"), "-12.346cqh"], [panorama.style.getPropertyValue("--panorama-y"), "67.891%"]);
    hook.rerender({ songId: "two", playing: false });
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });
  test("does not animate without a panorama element", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
    const hook = renderHook(({ playing }) => useKaraokePanorama("song", playing), {
      initialProps: { playing: false }
    });
    hook.rerender({ playing: true });
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
  test("resumes panorama animation from the accumulated clock", () => {
    const frames = stubFrameQueue();
    const now = vi.spyOn(performance, "now");
    now.mockReturnValue(100);
    const hook = renderHook(({ playing }) => useKaraokePanorama("song", playing), {
      initialProps: { playing: false }
    });
    const panorama = document.createElement("div");
    hook.result.current.panoramaRef.current = panorama;
    hook.rerender({ playing: true });
    act(() => frames.shift()(200));
    verify([mocks.getPanoramaPosition, "toHaveBeenLastCalledWith", 100, 240_000, [1, 2, 3]]);
    hook.rerender({ playing: false });
    now.mockReturnValue(300);
    hook.rerender({ playing: true });
    act(() => frames.at(-1)(350));
    verify([mocks.getPanoramaPosition, "toHaveBeenLastCalledWith", 150, 240_000, [1, 2, 3]]);
  });
  test("throttles frames in reduced-performance mode and refills themes", () => {
    const frames = stubFrameQueue();
    document.documentElement.dataset.performance = "reduced";
    mocks.shuffleThemes.mockReturnValueOnce([]).mockReturnValueOnce([{ id: "refilled" }]);
    const hook = renderHook(({ songId, playing }) => useKaraokePanorama(songId, playing), {
      initialProps: { songId: null, playing: false }
    });
    expect(hook.result.current.activeTheme).toEqual({ id: "fallback" });
    const panorama = document.createElement("div");
    hook.result.current.panoramaRef.current = panorama;
    hook.rerender({ songId: "song", playing: true });
    expect(hook.result.current.activeTheme).toEqual({ id: "refilled" });
    act(() => frames.shift()(10));
    expect(mocks.getPanoramaPosition).not.toHaveBeenCalled();
    act(() => frames.shift()(1000 / 15));
    expect(mocks.getPanoramaPosition).toHaveBeenCalledTimes(1);
    act(() => frames.shift()(80));
    expect(mocks.getPanoramaPosition).toHaveBeenCalledTimes(1);
  });
});
const guideProps = (overrides = {}) => ({
  notes: [{ start: 0, end: 1, note: 60 }],
  volume: 1,
  keyShift: 0,
  currentTimeRef: { current: 0 },
  ...overrides
});
const renderGuide = (overrides) => renderHook(() => useMelodyGuide(guideProps(overrides)));
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
    resume: vi.fn(() => (resumeError ? Promise.reject(resumeError) : Promise.resolve())),
    close: vi.fn(() => (closeError ? Promise.reject(closeError) : Promise.resolve()))
  };
  globalThis.AudioContext = class {
    constructor(options) {
      context.options = options;
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
        notes: [{ start: 0, end: 2, note: 69 }],
        volume: 0.5,
        keyShift: 0,
        currentTimeRef
      }
    });
    await expect(hook.result.current.startMelodyGuide()).resolves.toBe(true);
    await expect(hook.result.current.startMelodyGuide()).resolves.toBe(true);
    expect(audio.oscillator.start).toHaveBeenCalledOnce();
    verify([audio.context.options, "toEqual", { latencyHint: "interactive" }], [audio.oscillator.type, "toBe", "triangle"]);
    verify([audio.oscillator.frequency.setTargetAtTime, "toHaveBeenCalledWith", 440, 3, 0.012]);
    verify([audio.gain.gain.setTargetAtTime, "toHaveBeenCalledWith", 0.3 * 0.5 ** 1.65, 3, 0.02]);
    calledWith([audio.gain.gain.cancelScheduledValues, [3]], [audio.gain.gain.setValueAtTime, [0.0001, 3]]);
    const frequencyCalls = audio.oscillator.frequency.setTargetAtTime.mock.calls.length;
    act(() => hook.result.current.updateMelodyGuide(5));
    verify([audio.oscillator.frequency.setTargetAtTime, "toHaveBeenCalledTimes", frequencyCalls]);
    verify([audio.gain.gain.setTargetAtTime, "toHaveBeenLastCalledWith", 0.0001, 3, 0.018]);
    act(() => hook.result.current.silenceMelodyGuide());
    calledWith([audio.gain.gain.cancelScheduledValues, [3]], [audio.gain.gain.setValueAtTime, [0.0001, 3]]);
    hook.unmount();
    called(audio.oscillator.stop, audio.context.close);
  });
  test("articulates every new lyricsSync note", async () => {
    const audio = installGuideContext();
    const hook = renderHook((props) => useMelodyGuide(props), {
      initialProps: {
        notes: [
          { start: 0, end: 1, note: 69 },
          { start: 1, end: 2, note: 71 }
        ],
        volume: 0.5,
        keyShift: 0,
        currentTimeRef: { current: 0.5 }
      }
    });

    await hook.result.current.startMelodyGuide();
    act(() => hook.result.current.updateMelodyGuide(1.5));

    expect(audio.gain.gain.setValueAtTime).toHaveBeenCalledTimes(2);
    expect(audio.oscillator.frequency.setTargetAtTime).toHaveBeenLastCalledWith(expect.closeTo(493.883, 2), 3, 0.012);
    hook.unmount();
  });
  test("rejects missing inputs and cleans a guide whose resume fails", async () => {
    installGuideContext();
    const empty = renderHook(() => useMelodyGuide(guideProps({ notes: [] })));
    act(() => empty.result.current.updateMelodyGuide(0));
    act(() => empty.result.current.silenceMelodyGuide());
    expect(await empty.result.current.startMelodyGuide()).toBe(false);
    empty.unmount();
    for (const props of [
      { notes: null, volume: 1 },
      { notes: [{ start: 0, end: 1, note: 60 }], volume: 0 }
    ]) {
      const invalid = renderHook(() => useMelodyGuide(guideProps(props)));
      expect(await invalid.result.current.startMelodyGuide()).toBe(false);
      invalid.unmount();
    }
    delete globalThis.AudioContext;
    const unavailable = renderGuide();
    expect(await unavailable.result.current.startMelodyGuide()).toBe(false);
    unavailable.unmount();
    const failure = new Error("resume failed");
    const audio = installGuideContext({
      resumeError: failure,
      closeError: new Error("already closed")
    });
    const failed = renderGuide();
    await expect(failed.result.current.startMelodyGuide()).rejects.toThrow("resume failed");
    called(audio.oscillator.stop, audio.context.close);
  });
  test("closed guides ignore updates and are recreated on start", async () => {
    const first = installGuideContext();
    const hook = renderGuide();
    await hook.result.current.startMelodyGuide();
    first.context.state = "closed";
    const gainCalls = first.gain.gain.setTargetAtTime.mock.calls.length;
    const cancelCalls = first.gain.gain.cancelScheduledValues.mock.calls.length;
    act(() => hook.result.current.updateMelodyGuide(0));
    act(() => hook.result.current.silenceMelodyGuide());
    verify(
      [first.gain.gain.setTargetAtTime, "toHaveBeenCalledTimes", gainCalls],
      [first.gain.gain.cancelScheduledValues, "toHaveBeenCalledTimes", cancelCalls]
    );
    const second = installGuideContext();
    await expect(hook.result.current.startMelodyGuide()).resolves.toBe(true);
    expect(second.oscillator.start).toHaveBeenCalledOnce();
    hook.unmount();
  });
  test("start follows a replaced playback clock ref", async () => {
    const audio = installGuideContext();
    const hook = renderHook((props) => useMelodyGuide(props), {
      initialProps: {
        notes: [{ start: 0, end: 1, note: 60 }],
        volume: 1,
        keyShift: 0,
        currentTimeRef: { current: 5 }
      }
    });
    hook.rerender(guideProps({ currentTimeRef: { current: 0.5 } }));
    await hook.result.current.startMelodyGuide();
    expect(audio.oscillator.frequency.setTargetAtTime).toHaveBeenCalled();
    hook.unmount();
  });
  test("ignores an asynchronous close failure during disposal", async () => {
    const audio = installGuideContext({ closeError: new Error("already closed") });
    const hook = renderGuide();
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
    const hook = renderGuide();
    const start = hook.result.current.startMelodyGuide();
    hook.unmount();
    rejectResume(new Error("disposed"));
    await expect(start).rejects.toThrow("disposed");
  });
});
