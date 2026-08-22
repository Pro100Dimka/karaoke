/* @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import useKaraokeSceneFlow from "../src/pages/Karaoke/hooks/useKaraokeSceneFlow";
import { same, notCalled, calledTimes, calledWith, verify } from "./helpers/assertions.mjs";

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
  showControls: vi.fn(),
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
    expect(input.showControls).toHaveBeenCalledOnce();
    calledWith(
      [input.togglePlay, [{ forcePlaying: true }]],
      [input.turnOffRadio, [{ remember: false }]],
      [input.turnOnRadio, [{ remember: false, fadeIn: true }]]
    );
    same(
      [hook.result.current.sceneBlackout, false],
      [hook.result.current.sceneIntroVisible, false],
      [hook.result.current.sceneTransitioning, false]
    );
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
    verify([input.togglePlay, "toHaveBeenCalledTimes", 1], [input.stop, "not.toHaveBeenCalled"]);
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
    calledTimes([input.hideControls, 1], [input.togglePlay, 1]);
    input = { ...input, isPlaying: false };
    hook.rerender();
    await expect(hook.result.current.handleTogglePlay()).resolves.toBe(true);
    expect(input.togglePlay).toHaveBeenNthCalledWith(2, { forcePlaying: true });
    calledTimes([input.hideControls, 1], [input.turnOffRadio, 2]);
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
    const fadeIn = { remember: false, fadeIn: true };
    calledWith([input.setRecordingActive, [false]], [input.turnOnRadio, [fadeIn]]);
  });
  test("failed pause does not restore radio or change recording state", async () => {
    const input = props({ isPlaying: true, togglePlay: vi.fn().mockResolvedValue(false) });
    const hook = renderHook(() => useKaraokeSceneFlow(input));
    await expect(hook.result.current.handleTogglePlay()).resolves.toBe(false);
    expect(input.togglePlay).toHaveBeenCalledWith({ forcePlaying: false });
    notCalled(input.setRecordingActive, input.turnOnRadio);
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
    verify([slowMedia.addEventListener, "toHaveBeenCalledWith", "canplay", expect.any(Function), { once: true }]);
    verify([slowMedia.addEventListener, "toHaveBeenCalledWith", "error", expect.any(Function), { once: true }]);
    calledWith(
      [slowMedia.removeEventListener, ["canplay", expect.any(Function)]],
      [slowMedia.removeEventListener, ["error", expect.any(Function)]]
    );
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
    same(
      [hook.result.current.sceneBlackout, false],
      [hook.result.current.sceneTransitioning, false],
      [hook.result.current.stageActionsVisible, true]
    );
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
    verify([
      input.navigate,
      "toHaveBeenCalledWith",
      "/",
      { replace: true, state: { fromKaraokeFade: true, analysisRecordingId: "recording-7" } }
    ]);
    expect(routeEvents).toContainEqual({ visible: true });
    window.removeEventListener("app:route-blackout", listener);
  });
  test("direct blackout navigation normalizes an absent analysis id", () => {
    const input = props();
    const hook = renderHook(() => useKaraokeSceneFlow(input));
    act(() => hook.result.current.navigateToLibraryFromBlackout(""));
    verify([input.navigate, "toHaveBeenCalledWith", "/", { replace: true, state: { fromKaraokeFade: true, analysisRecordingId: null } }]);
  });
  test("autostart starts once when media exists and releases initial route blackout", async () => {
    const routeEvents = [];
    const listener = (event) => routeEvents.push(event.detail.visible);
    window.addEventListener("app:route-blackout", listener);
    const input = props({ autoStartRequested: true, togglePlay: vi.fn().mockResolvedValue(true) });
    const hook = renderHook(() => useKaraokeSceneFlow(input));
    await act(async () => vi.runAllTimersAsync());
    verify(
      [input.togglePlay, "toHaveBeenCalledTimes", 1],
      [input.togglePlay, "toHaveBeenCalledWith", { forcePlaying: true }],
      [routeEvents, "toContain", false]
    );
    const scene = hook.result.current;
    same([scene.sceneBlackout, false], [scene.sceneTransitioning, false]);
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
    const scene = hook.result.current;
    same([scene.sceneBlackout, false], [scene.sceneTransitioning, false]);
  });
});
