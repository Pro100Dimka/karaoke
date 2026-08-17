/* @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import useKaraokeSceneFlow from "../src/pages/Karaoke/hooks/useKaraokeSceneFlow";

const media = (overrides = {}) => ({ readyState: 4, load: vi.fn(), ...overrides });
const props = (overrides = {}) => ({
  analysisRecordingIdRef: { current: null },
  autoStartRequested: false,
  hideControls: vi.fn(),
  instrumentalRef: { current: media() },
  vocalsRef: { current: null },
  isPlaying: false,
  isRadioPlaying: true,
  navigate: vi.fn(),
  setRecordingActive: vi.fn(),
  songId: "song",
  stop: vi.fn().mockResolvedValue(true),
  togglePlay: vi.fn().mockResolvedValue(false),
  turnOffRadio: vi.fn(),
  turnOnRadio: vi.fn().mockResolvedValue(true),
  ...overrides
});

const runTimersFor = async (milliseconds) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("karaoke scene flow", () => {
  test("propagates failed playback and restores radio after intro", async () => {
    const input = props();
    const hook = renderHook(() => useKaraokeSceneFlow(input));
    let result;
    await act(async () => {
      const pending = hook.result.current.handleTogglePlay();
      await vi.runAllTimersAsync();
      result = await pending;
    });
    expect(result).toBe(false);
    expect(input.hideControls).toHaveBeenCalledOnce();
    expect(input.togglePlay).toHaveBeenCalledWith({ forcePlaying: true });
    expect(input.turnOffRadio).toHaveBeenCalledWith({ remember: false });
    expect(input.turnOnRadio).toHaveBeenCalledWith({ remember: false, fadeIn: true });
    expect(hook.result.current.sceneBlackout).toBe(false);
    expect(hook.result.current.sceneIntroVisible).toBe(false);
    expect(hook.result.current.sceneTransitioning).toBe(false);
  });


  test("transition guard rejects overlapping play and stop commands", async () => {
    const input = props({ togglePlay: vi.fn().mockResolvedValue(true) });
    const hook = renderHook(() => useKaraokeSceneFlow(input));
    let first;
    let second;
    let stopResult;
    await act(async () => {
      first = hook.result.current.handleTogglePlay();
      second = hook.result.current.handleTogglePlay();
      stopResult = hook.result.current.handleStop();
      await vi.runAllTimersAsync();
    });
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
    await expect(stopResult).resolves.toBe(false);
    expect(input.togglePlay).toHaveBeenCalledTimes(1);
    expect(input.stop).not.toHaveBeenCalled();
  });

  test("successful first start uses intro once, then resume skips the intro", async () => {
    let input = props({ togglePlay: vi.fn().mockResolvedValue(true) });
    const hook = renderHook(() => useKaraokeSceneFlow(input));

    let started;
    await act(async () => {
      const pending = hook.result.current.handleTogglePlay();
      await vi.runAllTimersAsync();
      started = await pending;
    });
    expect(started).toBe(true);
    expect(input.hideControls).toHaveBeenCalledTimes(1);
    expect(input.togglePlay).toHaveBeenCalledTimes(1);

    input = { ...input, isPlaying: false };
    hook.rerender();
    await expect(hook.result.current.handleTogglePlay()).resolves.toBe(true);
    expect(input.togglePlay).toHaveBeenNthCalledWith(2, { forcePlaying: true });
    expect(input.hideControls).toHaveBeenCalledTimes(1);
    expect(input.turnOffRadio).toHaveBeenCalledTimes(2);
  });

  test("pausing after a radio-backed start restores radio and recording state", async () => {
    let input = props({ togglePlay: vi.fn().mockResolvedValue(true) });
    const hook = renderHook(() => useKaraokeSceneFlow(input));
    await act(async () => {
      const pending = hook.result.current.handleTogglePlay();
      await vi.runAllTimersAsync();
      await pending;
    });

    input = { ...input, isPlaying: true };
    hook.rerender();
    await expect(hook.result.current.handleTogglePlay()).resolves.toBe(true);
    expect(input.togglePlay).toHaveBeenLastCalledWith({ forcePlaying: false });
    expect(input.setRecordingActive).toHaveBeenCalledWith(false);
    expect(input.turnOnRadio).toHaveBeenCalledWith({ remember: false, fadeIn: true });
  });

  test("failed pause does not restore radio or change recording state", async () => {
    const input = props({ isPlaying: true, togglePlay: vi.fn().mockResolvedValue(false) });
    const hook = renderHook(() => useKaraokeSceneFlow(input));
    await expect(hook.result.current.handleTogglePlay()).resolves.toBe(false);
    expect(input.togglePlay).toHaveBeenCalledWith({ forcePlaying: false });
    expect(input.setRecordingActive).not.toHaveBeenCalled();
    expect(input.turnOnRadio).not.toHaveBeenCalled();
  });

  test("stage actions auto-hide and reveal restarts the exact hide timer", async () => {
    const hook = renderHook(() => useKaraokeSceneFlow(props()));
    expect(hook.result.current.stageActionsVisible).toBe(true);
    await runTimersFor(1800);
    expect(hook.result.current.stageActionsVisible).toBe(false);

    act(() => hook.result.current.revealStageActions());
    expect(hook.result.current.stageActionsVisible).toBe(true);
    await runTimersFor(1000);
    act(() => hook.result.current.revealStageActions());
    await runTimersFor(1799);
    expect(hook.result.current.stageActionsVisible).toBe(true);
    await runTimersFor(1);
    expect(hook.result.current.stageActionsVisible).toBe(false);
  });

  test("media preloading calls load and resolves the intro on readiness timeout", async () => {
    const listeners = new Map();
    const slowMedia = media({
      readyState: 0,
      addEventListener: vi.fn((name, listener) => listeners.set(name, listener)),
      removeEventListener: vi.fn((name) => listeners.delete(name))
    });
    const input = props({
      instrumentalRef: { current: slowMedia },
      vocalsRef: { current: null },
      togglePlay: vi.fn().mockResolvedValue(true)
    });
    const hook = renderHook(() => useKaraokeSceneFlow(input));
    let result;
    await act(async () => {
      const pending = hook.result.current.handleTogglePlay();
      await vi.runAllTimersAsync();
      result = await pending;
    });
    expect(result).toBe(true);
    expect(slowMedia.load).toHaveBeenCalledOnce();
    expect(slowMedia.addEventListener).toHaveBeenCalledWith("canplay", expect.any(Function), {
      once: true
    });
    expect(slowMedia.addEventListener).toHaveBeenCalledWith("error", expect.any(Function), {
      once: true
    });
    expect(slowMedia.removeEventListener).toHaveBeenCalledWith("canplay", expect.any(Function));
    expect(slowMedia.removeEventListener).toHaveBeenCalledWith("error", expect.any(Function));
    expect(listeners.size).toBe(0);
  });

  test("stop failure restores stage state without navigating", async () => {
    const input = props({ stop: vi.fn().mockResolvedValue(false) });
    const hook = renderHook(() => useKaraokeSceneFlow(input));
    let result;
    await act(async () => {
      const pending = hook.result.current.handleStop();
      await vi.advanceTimersByTimeAsync(430);
      result = await pending;
    });
    expect(result).toBe(false);
    expect(input.stop).toHaveBeenCalledOnce();
    expect(input.navigate).not.toHaveBeenCalled();
    expect(hook.result.current.sceneBlackout).toBe(false);
    expect(hook.result.current.sceneTransitioning).toBe(false);
    expect(hook.result.current.stageActionsVisible).toBe(true);
  });

  test("successful stop blackouts the route and carries the analysis id to library", async () => {
    const routeEvents = [];
    const listener = (event) => routeEvents.push(event.detail);
    window.addEventListener("app:route-blackout", listener);
    const input = props({ analysisRecordingIdRef: { current: "recording-7" } });
    const hook = renderHook(() => useKaraokeSceneFlow(input));
    let result;
    await act(async () => {
      const pending = hook.result.current.handleStop();
      await vi.advanceTimersByTimeAsync(470);
      result = await pending;
    });
    expect(result).toBe(true);
    expect(input.navigate).toHaveBeenCalledWith("/", {
      replace: true,
      state: { fromKaraokeFade: true, analysisRecordingId: "recording-7" }
    });
    expect(routeEvents).toContainEqual({ visible: true });
    window.removeEventListener("app:route-blackout", listener);
  });

  test("direct blackout navigation normalizes an absent analysis id", () => {
    const input = props();
    const hook = renderHook(() => useKaraokeSceneFlow(input));
    act(() => hook.result.current.navigateToLibraryFromBlackout(""));
    expect(input.navigate).toHaveBeenCalledWith("/", {
      replace: true,
      state: { fromKaraokeFade: true, analysisRecordingId: null }
    });
  });

  test("autostart starts once when media exists and releases initial route blackout", async () => {
    const routeEvents = [];
    const listener = (event) => routeEvents.push(event.detail.visible);
    window.addEventListener("app:route-blackout", listener);
    const input = props({ autoStartRequested: true, togglePlay: vi.fn().mockResolvedValue(true) });
    const hook = renderHook(() => useKaraokeSceneFlow(input));
    await act(async () => vi.runAllTimersAsync());
    expect(input.togglePlay).toHaveBeenCalledTimes(1);
    expect(input.togglePlay).toHaveBeenCalledWith({ forcePlaying: true });
    expect(routeEvents).toContain(false);
    expect(hook.result.current.sceneBlackout).toBe(false);
    expect(hook.result.current.sceneTransitioning).toBe(false);
    window.removeEventListener("app:route-blackout", listener);
  });

  test("autostart gives up deterministically when media never becomes available", async () => {
    const input = props({
      autoStartRequested: true,
      instrumentalRef: { current: null },
      vocalsRef: { current: null }
    });
    const hook = renderHook(() => useKaraokeSceneFlow(input));
    await act(async () => vi.runAllTimersAsync());
    expect(input.togglePlay).not.toHaveBeenCalled();
    expect(hook.result.current.sceneBlackout).toBe(false);
    expect(hook.result.current.sceneTransitioning).toBe(false);
  });
});
