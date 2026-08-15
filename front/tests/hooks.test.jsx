/* @vitest-environment jsdom */
import { useRef } from "react";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getResult: vi.fn(),
  getHealth: vi.fn(),
  getPipelineHealth: vi.fn(),
  getVersions: vi.fn(),
  getErrors: vi.fn()
}));
vi.mock("../src/api/client", () => ({ api: apiMocks }));

import useAsyncQueue from "../src/hooks/useAsyncQueue.js";
import useExclusiveAsyncAction from "../src/hooks/useExclusiveAsyncAction.js";
import useLatestRef from "../src/hooks/useLatestRef.js";
import useMountedRef from "../src/hooks/useMountedRef.js";
import { shouldSchedulePoll, usePolling } from "../src/hooks/usePolling.js";
import { translateSaved } from "../src/i18n/runtime.js";
import { isHotkeyScopeActive } from "../src/utils/hotkeys.js";
import useSettingsNavigation from "../src/hooks/useSettingsNavigation.js";
import useKaraokeControls from "../src/pages/Karaoke/hooks/useKaraokeControls.js";
import useKaraokeHotkeys, {
  dispatchKaraokeHotkey
} from "../src/pages/Karaoke/hooks/useKaraokeHotkeys.js";
import useKaraokeResult from "../src/pages/Karaoke/hooks/useKaraokeResult.js";
import useKaraokeStageLayout from "../src/pages/Karaoke/hooks/useKaraokeStageLayout.js";
import { getKaraokeStageLayout } from "../src/pages/Karaoke/utils/layout.js";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
beforeEach(() => Object.values(apiMocks).forEach((mock) => mock.mockReset()));

describe("async state hooks", () => {
  test.each([
    [{ active: false, hidden: false, intervalMs: 10 }, false],
    [{ active: true, hidden: true, intervalMs: 10 }, false],
    [{ active: true, hidden: false, intervalMs: Number.NaN }, false],
    [{ active: true, hidden: false, intervalMs: 0 }, false],
    [{ active: true, hidden: false, intervalMs: -1 }, false],
    [ { active: true, hidden: false, intervalMs: 10, error: new Error("retry") }, true ],
    [
      {
        active: true,
        hidden: false,
        intervalMs: 10,
        error: new Error("stop"),
        shouldRetryError: () => false
      },
      false
    ],
    [
      {
        active: true,
        hidden: false,
        intervalMs: 10,
        error: new Error("retry"),
        shouldRetryError: () => true
      },
      true
    ],
    [
      { active: true, hidden: false, intervalMs: 10, result: "stop", shouldContinue: () => false },
      false
    ],
    [
      {
        active: true,
        hidden: false,
        intervalMs: 10,
        result: "continue",
        shouldContinue: () => true
      },
      true
    ],
    [{ active: true, hidden: false, intervalMs: 10, result: "default" }, true]
  ])("decides whether polling should continue %#", (options, expected) => {
    expect(shouldSchedulePoll(options)).toBe(expected);
  });

  test("latest and mounted refs track lifecycle", () => {
    const latest = renderHook(({ value }) => useLatestRef(value), { initialProps: { value: 1 } });
    expect(latest.result.current.current).toBe(1);
    latest.rerender({ value: 2 });
    expect(latest.result.current.current).toBe(2);
    let mountedDuringRender;
    const mounted = renderHook(() => {
      const ref = useMountedRef();
      mountedDuringRender = ref.current;
      return ref;
    });
    expect(mountedDuringRender).toBe(true);
    expect(mounted.result.current.current).toBe(true);
    const ref = mounted.result.current;
    mounted.unmount();
    expect(ref.current).toBe(false);
  });

  test("serializes queued actions and survives failures", async () => {
    let pendingDuringRender;
    const { result, unmount } = renderHook(() => {
      const queue = useAsyncQueue();
      pendingDuringRender = queue.pending;
      return queue;
    });
    expect(pendingDuringRender).toBe(false);
    const order = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let releaseSecond;
    const secondGate = new Promise((resolve) => { releaseSecond = resolve; });
    let first;
    let second;
    await act(async () => {
      first = result.current.run(async () => {
        order.push(1);
        await gate;
        order.push(2);
        return "a";
      });
      second = result.current.run(async () => { order.push(3); await secondGate; return "b"; });
      await Promise.resolve();
    });
    expect(result.current.pending).toBe(true);
    await act(async () => {
      release();
      await expect(first).resolves.toBe("a");
      await Promise.resolve();
    });
    expect(order).toEqual([1, 2, 3]);
    expect(result.current.pending).toBe(true);
    await act(async () => { releaseSecond(); await expect(second).resolves.toBe("b"); });
    expect(result.current.pending).toBe(false);
    await expect(result.current.run(null)).rejects.toThrow(
      translateSaved("Операция очереди должна быть функцией")
    );
    await expect( result.current.run(() => Promise.reject(new Error("bad")))
    ).rejects.toThrow("bad");
    unmount();
  });

  test("reuses one exclusive action promise", async () => {
    let pendingDuringRender;
    const { result, unmount } = renderHook(() => {
      const exclusive = useExclusiveAsyncAction();
      pendingDuringRender = exclusive.pending;
      return exclusive;
    });
    expect(pendingDuringRender).toBe(false);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const action = vi.fn(() => gate);
    let first;
    let second;
    act(() => { first = result.current.run(action); second = result.current.run(action); });
    expect(first).toBe(second);
    expect(result.current.pending).toBe(true);
    release("done");
    await expect(first).resolves.toBe("done");
    await act(async () => {});
    expect(result.current.pending).toBe(false);
    expect(action).toHaveBeenCalledOnce();
    unmount();
  });

  test("settles queued and exclusive work safely after unmount", async () => {
    let releaseQueue;
    const queued = renderHook(() => useAsyncQueue());
    const queuedPromise = queued.result.current.run(
      () =>
        new Promise((resolve) => { releaseQueue = resolve; })
    );
    await act(async () => Promise.resolve());
    queued.unmount();
    releaseQueue("queued");
    await expect(queuedPromise).resolves.toBe("queued");
    await expect(queued.result.current.run(() => "after")).resolves.toBe( "after"
    );

    const exclusive = renderHook(() => useExclusiveAsyncAction());
    exclusive.unmount();
    await expect(exclusive.result.current.run(() => "done")).resolves.toBe( "done"
    );
  });

  test("ignores a polling rejection after unmount", async () => {
    let rejectFetch;
    const hook = renderHook(() =>
      usePolling( () => new Promise((_resolve, reject) => { rejectFetch = reject; }), 100
      )
    );
    await act(async () => Promise.resolve());
    hook.unmount();
    rejectFetch(new Error("obsolete"));
    await act(async () => Promise.resolve());
  });

  test("polls without overlap, refreshes, stops and reports errors", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error("offline"));
    const { result, unmount } = renderHook(() =>
      usePolling(fetcher, 100, [], {
        shouldContinue: (value) => value < 2,
        shouldRetryError: () => false
      })
    );
    await act(async () => { await Promise.resolve(); });
    expect(result.current.data).toBe(1);
    await act(async () => { vi.advanceTimersByTime(100); await Promise.resolve(); });
    expect(result.current.error?.message).toBe("offline");
    await act(async () => { result.current.refresh(); await Promise.resolve(); });
    unmount();
  });

  test("polling resumes on visibility and coalesces overlapping refreshes", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    const visibleFetcher = vi.fn().mockResolvedValue("visible");
    const hidden = renderHook(() => usePolling(visibleFetcher, 100));
    expect(visibleFetcher).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(hidden.result.current.data).toBe("visible"));
    hidden.unmount();

    let release;
    const first = new Promise((resolve) => { release = resolve; });
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce("second");
    const polling = renderHook(() => usePolling(fetcher, 0));
    act(() => { polling.result.current.refresh(); polling.result.current.refresh(); });
    expect(fetcher).toHaveBeenCalledOnce();
    release("first");
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(polling.result.current.data).toBe("second"));
    polling.unmount();
  });

  test("ignores late results and replaces a scheduled poll on visibility", async () => {
    vi.useFakeTimers();
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const late = renderHook(() => usePolling(() => pending, 100));
    act(() => { late.result.current.refresh(); });
    late.unmount();
    await act(async () => { release("late"); await pending; });

    const fetcher = vi.fn().mockResolvedValue("ready");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    const visible = renderHook(() => usePolling(fetcher, 100));
    await act(async () => Promise.resolve());
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => Promise.resolve());
    expect(fetcher).toHaveBeenCalledTimes(2);
    visible.unmount();
  });

  test("restarts for dependency changes and uses the latest fetcher", async () => {
    const first = vi.fn().mockResolvedValue("first");
    const second = vi.fn().mockResolvedValue("second");
    const polling = renderHook(
      ({ dependency, fetcher }) => usePolling(fetcher, 0, [dependency]),
      { initialProps: { dependency: 1, fetcher: first } }
    );
    await waitFor(() => expect(polling.result.current.data).toBe("first"));
    polling.rerender({ dependency: 2, fetcher: second });
    await waitFor(() => expect(polling.result.current.data).toBe("second"));
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    polling.unmount();
    expect(() => polling.result.current.refresh()).not.toThrow();
  });

  test("rejects a detached hotkey scope and ignores a stale poll timer", async () => {
    expect(isHotkeyScopeActive(document.createElement("div"))).toBe(false);
    let scheduled;
    vi.stubGlobal( "setTimeout", vi.fn((callback) => { scheduled = callback; return 1; })
    );
    const fetcher = vi.fn().mockResolvedValue("ok");
    const removeListener = vi.spyOn(document, "removeEventListener");
    const polling = renderHook(() => usePolling(fetcher, 10));
    await act(async () => Promise.resolve());
    polling.unmount();
    await act(async () => scheduled());
    expect(fetcher).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledWith( "visibilitychange", expect.any(Function)
    );
    expect(() => polling.result.current.refresh()).not.toThrow();
    vi.unstubAllGlobals();
  });
});

describe("navigation and karaoke hooks", () => {
  test("changes settings navigation", () => {
    const defaults = renderHook(() => useSettingsNavigation());
    expect(defaults.result.current).toMatchObject({ tab: "audio", service: null });
    defaults.unmount();
    const { result } = renderHook(() => useSettingsNavigation("general"));
    expect(result.current.tab).toBe("general");
    act(() => result.current.openService("audio"));
    expect(result.current.service).toBe("audio");
    act(() => result.current.closeService());
    expect(result.current.service).toBeNull();
    act(() => result.current.selectTab("storage"));
    expect(result.current).toMatchObject({ tab: "storage", service: null });
  });

  test("auto-hides and reveals karaoke controls", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const setInterval = vi.spyOn(window, "setInterval");
    const clearInterval = vi.spyOn(window, "clearInterval");
    const addEvent = vi.spyOn(document, "addEventListener");
    const removeEvent = vi.spyOn(document, "removeEventListener");
    const { result, rerender, unmount } = renderHook(
      ({ enabled }) => useKaraokeControls({ autoHideEnabled: enabled }),
      { initialProps: { enabled: true } }
    );
    expect(setInterval).toHaveBeenCalledOnce();
    expect(setInterval.mock.calls[0][1]).toBe(250);
    const checkVisibility = setInterval.mock.calls[0][0];
    act(() => { vi.setSystemTime(2199); checkVisibility(); });
    expect(result.current.controlsVisible).toBe(true);
    act(() => { vi.setSystemTime(2200); checkVisibility(); });
    expect(result.current.controlsVisible).toBe(false);
    act(() => result.current.revealControls());
    expect(result.current.controlsVisible).toBe(true);
    act(() => { vi.setSystemTime(4399); checkVisibility(); });
    expect(result.current.controlsVisible).toBe(true);
    act(() => { vi.setSystemTime(4400); checkVisibility(); });
    expect(result.current.controlsVisible).toBe(false);
    act(() => result.current.hideControls());
    expect(result.current.controlsVisible).toBe(false);
    fireEventFullscreen();
    expect(result.current.controlsVisible).toBe(true);
    rerender({ enabled: false });
    expect(result.current.controlsVisible).toBe(true);
    expect(setInterval).toHaveBeenCalledTimes(1);
    act(() => result.current.hideControls());
    act(() => result.current.revealControls());
    expect(result.current.controlsVisible).toBe(false);
    rerender({ enabled: true });
    expect(result.current.controlsVisible).toBe(true);
    expect(setInterval).toHaveBeenCalledTimes(2);
    const fullscreenRegistration = addEvent.mock.calls.find(
      ([event]) => event === "fullscreenchange"
    );
    expect(fullscreenRegistration).toBeDefined();
    unmount();
    expect(clearInterval).toHaveBeenCalled();
    expect(removeEvent).toHaveBeenCalledWith( "fullscreenchange", fullscreenRegistration[1]
    );
  });

  test("enables control auto-hide by default", () => {
    vi.useFakeTimers();
    const setInterval = vi.spyOn(window, "setInterval");
    renderHook(() => useKaraokeControls());
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 250);
  });

  test("renders controls as visible before mount effects run", () => {
    const snapshots = [];
    const Probe = () => {
      snapshots.push(useKaraokeControls({ autoHideEnabled: false }));
      return null;
    };
    render(<Probe />);
    expect(snapshots[0].controlsVisible).toBe(true);
  });

  test("dispatches scoped karaoke hotkeys", () => {
    const toggle = vi.fn();
    const seek = vi.fn();
    const stop = vi.fn();
    const scope = document.createElement("div");
    document.body.append(scope);
    const addEvent = vi.spyOn(window, "addEventListener");
    const removeEvent = vi.spyOn(window, "removeEventListener");
    const hook = renderHook(
      ({ scopeRef }) =>
        useKaraokeHotkeys({
          scopeRef,
          currentTime: 3,
          duration: 6,
          onTogglePlay: toggle,
          onSeek: seek,
          onStop: stop
        }),
      { initialProps: { scopeRef: { current: scope } } }
    );
    const events = ["Space", "ArrowLeft", "ArrowRight", "Escape", "KeyA"].map(
      (code) =>
        new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true })
    );
    events.forEach((event) => scope.dispatchEvent(event));
    expect(events.map(({ defaultPrevented }) => defaultPrevented)).toEqual([
      true,
      true,
      true,
      false,
      false
    ]);
    expect(toggle).toHaveBeenCalledOnce();
    expect(seek.mock.calls).toEqual([[0], [6]]);
    expect(stop).toHaveBeenCalledOnce();

    const nextScope = document.createElement("div");
    document.body.append(nextScope);
    hook.rerender({ scopeRef: { current: nextScope } });
    scope.remove();
    scope.dispatchEvent( new KeyboardEvent("keydown", { code: "Space", bubbles: true })
    );
    expect(toggle).toHaveBeenCalledOnce();
    nextScope.dispatchEvent( new KeyboardEvent("keydown", { code: "Space", bubbles: true })
    );
    expect(toggle).toHaveBeenCalledTimes(2);

    const keydownRegistration = addEvent.mock.calls.find( ([event]) => event === "keydown"
    );
    expect(keydownRegistration).toBeDefined();
    hook.unmount();
    expect(removeEvent).toHaveBeenCalledWith("keydown", expect.any(Function));
  });

  test("dispatches every karaoke command with optional callbacks", () => {
    const toggle = vi.fn();
    const seek = vi.fn();
    const stop = vi.fn();
    const context = {
      currentTime: 3,
      duration: 6,
      onTogglePlay: toggle,
      onSeek: seek,
      onStop: stop
    };
    dispatchKaraokeHotkey("toggle-playback", context);
    expect(toggle).toHaveBeenCalledOnce();
    expect(seek).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    dispatchKaraokeHotkey("seek-backward", context);
    expect(seek.mock.calls).toEqual([[0]]);
    expect(stop).not.toHaveBeenCalled();
    dispatchKaraokeHotkey("seek-forward", context);
    expect(seek.mock.calls).toEqual([[0], [6]]);
    expect(stop).not.toHaveBeenCalled();
    dispatchKaraokeHotkey("stop", context);
    expect(stop).toHaveBeenCalledOnce();
    dispatchKaraokeHotkey("unknown", context);
    expect(stop).toHaveBeenCalledTimes(2);
    for (const action of [ "toggle-playback", "seek-backward", "seek-forward", "stop" ]) {
      expect(() => dispatchKaraokeHotkey(action, { currentTime: 0, duration: 0 })
      ).not.toThrow();
    }
  });

  test("loads, rejects and resets karaoke results safely", async () => {
    let resolve;
    const success = new Promise((done) => { resolve = done; });
    const failure = new Error("bad");
    let reject;
    const failed = new Promise((_resolve, fail) => { reject = fail; });
    apiMocks.getResult.mockImplementation((id) => id === "one" ? success : failed
    );
    const { result, rerender, unmount } = renderHook(
      ({ song }) => useKaraokeResult(song),
      { initialProps: { song: { id: "one", status: "done", updated_at: 1 } } }
    );
    expect(result.current.loading).toBe(true);
    await act(async () => resolve({ notes: [] }));
    await waitFor(() =>
      expect(result.current).toEqual({ result: { notes: [] }, loading: false, error: null })
    );
    rerender({ song: { id: "two", status: "done", updated_at: 2 } });
    await act(async () => reject(failure));
    expect(result.current).toEqual({ result: null, loading: false, error: failure });
    rerender({ song: { id: "two", status: "processing", updated_at: 3 } });
    expect(result.current).toEqual({ result: null, loading: false, error: null });
    unmount();
  });

  test("starts karaoke result state from the exact idle contract", async () => {
    const snapshots = [];
    const Probe = ({ song }) => {
      snapshots.push(useKaraokeResult(song));
      return null;
    };
    let releaseInitial;
    apiMocks.getResult.mockReturnValueOnce( new Promise((resolve) => { releaseInitial = resolve; })
    );
    const initial = render( <Probe song={{ id: "initial", status: "done", updated_at: 0 }} />
    );
    expect(snapshots[0]).toEqual({ result: null, loading: false, error: null });
    releaseInitial({ notes: [] });
    await act(async () => Promise.resolve());
    initial.unmount();
  });

  test("ignores karaoke result completion after cancellation", async () => {
    let resolveResult;
    apiMocks.getResult.mockReturnValueOnce( new Promise((resolve) => { resolveResult = resolve; })
    );
    const resolved = renderHook(({ song }) => useKaraokeResult(song), {
      initialProps: { song: { id: "late", status: "done" } }
    });
    resolved.rerender({ song: null });
    resolveResult({ notes: [1] });
    await act(async () => Promise.resolve());
    expect(resolved.result.current.result).toBeNull();

    let rejectResult;
    apiMocks.getResult.mockReturnValueOnce(
      new Promise((_resolve, reject) => { rejectResult = reject; })
    );
    const rejected = renderHook(({ song }) => useKaraokeResult(song), {
      initialProps: { song: { id: "late-error", status: "done" } }
    });
    rejected.rerender({ song: null });
    rejectResult(new Error("obsolete"));
    await act(async () => Promise.resolve());
    expect(rejected.result.current).toEqual({ result: null, loading: false, error: null });
  });

  test("synchronizes stage CSS and cleans observer", () => {
    const shell = document.createElement("div");
    shell.className = "karaoke-app-shell";
    shell.style.setProperty("--karaoke-nav-extra", "10");
    const main = document.createElement("main");
    const stage = document.createElement("section");
    main.append(stage);
    shell.append(main);
    document.body.append(shell);
    for (const [node, width, height] of [ [main, 1000, 700], [stage, 800, 450] ]) {
      Object.defineProperties(node, {
        clientWidth: { configurable: true, value: width },
        clientHeight: { configurable: true, value: height }
      });
    }
    const disconnect = vi.fn();
    const observe = vi.fn();
    let resizeCallback;
    globalThis.ResizeObserver = class {
      constructor(callback) {
        resizeCallback = callback;
      }
      observe(node) {
        observe(node);
      }
      disconnect() {
        disconnect();
      }
    };
    const { unmount } = renderHook(() => {
      const stageRef = useRef(stage);
      useKaraokeStageLayout(stageRef);
    });
    const expected = getKaraokeStageLayout({
      mainWidth: 1000,
      mainHeight: 700,
      stageWidth: 800,
      stageHeight: 450,
      currentNavExtra: 10
    });
    expect(observe.mock.calls).toEqual([[main], [stage]]);
    expect(shell.style.getPropertyValue("--karaoke-nav-extra")).toBe(
      `${expected.navExtra}px`
    );
    expect(stage.style.getPropertyValue("--karaoke-video-width")).toBe(
      `${expected.videoWidth}px`
    );
    expect(stage.style.getPropertyValue("--karaoke-video-height")).toBe(
      `${expected.videoHeight}px`
    );
    act(() => resizeCallback());
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(shell.style.getPropertyValue("--karaoke-nav-extra")).toBe("");
    expect(stage.style.getPropertyValue("--karaoke-video-width")).toBe("");
    expect(stage.style.getPropertyValue("--karaoke-video-height")).toBe("");
    shell.remove();
  });

  test("skips stage synchronization when any required node is missing", () => {
    document
      .querySelectorAll(".karaoke-app-shell")
      .forEach((element) => element.remove());
    const observe = vi.fn();
    globalThis.ResizeObserver = class {
      constructor() {
        observe("constructed");
      }
      observe() {}
      disconnect() {}
    };

    const detachedMain = document.createElement("main");
    const stageWithoutShell = document.createElement("section");
    detachedMain.append(stageWithoutShell);
    expect(() => renderHook(() => useKaraokeStageLayout({ current: stageWithoutShell }))
    ).not.toThrow();

    const shell = document.createElement("div");
    shell.className = "karaoke-app-shell";
    document.body.append(shell);
    expect(() => renderHook(() => useKaraokeStageLayout({ current: null }))
    ).not.toThrow();

    const detachedStage = document.createElement("section");
    expect(() => renderHook(() => useKaraokeStageLayout({ current: detachedStage }))
    ).not.toThrow();
    expect(observe).not.toHaveBeenCalled();
    shell.remove();
  });

  test("moves stage synchronization when the stage ref changes", () => {
    const shell = document.createElement("div");
    shell.className = "karaoke-app-shell";
    const stages = [ document.createElement("section"), document.createElement("section") ];
    for (const [index, stage] of stages.entries()) {
      const main = document.createElement("main");
      main.append(stage);
      shell.append(main);
      Object.defineProperties(main, {
        clientWidth: { configurable: true, value: 900 + index * 100 },
        clientHeight: { configurable: true, value: 600 }
      });
      Object.defineProperties(stage, {
        clientWidth: { configurable: true, value: 800 },
        clientHeight: { configurable: true, value: 450 }
      });
    }
    document.body.append(shell);
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
    const hook = renderHook(({ stageRef }) => useKaraokeStageLayout(stageRef), {
      initialProps: { stageRef: { current: stages[0] } }
    });
    expect(stages[0].style.getPropertyValue("--karaoke-video-width")).not.toBe( ""
    );
    hook.rerender({ stageRef: { current: stages[1] } });
    expect(stages[0].style.getPropertyValue("--karaoke-video-width")).toBe("");
    expect(stages[1].style.getPropertyValue("--karaoke-video-width")).not.toBe( ""
    );
    shell.remove();
  });
});

function fireEventFullscreen() {
  act(() => document.dispatchEvent(new Event("fullscreenchange")));
}
