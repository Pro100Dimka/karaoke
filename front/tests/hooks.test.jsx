/* @vitest-environment jsdom */
import React, { useRef } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
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
import { usePolling } from "../src/hooks/usePolling.js";
import useSettingsNavigation from "../src/hooks/useSettingsNavigation.js";
import useKaraokeControls from "../src/pages/Karaoke/hooks/useKaraokeControls.js";
import useKaraokeHotkeys from "../src/pages/Karaoke/hooks/useKaraokeHotkeys.js";
import useKaraokeResult from "../src/pages/Karaoke/hooks/useKaraokeResult.js";
import useKaraokeStageLayout from "../src/pages/Karaoke/hooks/useKaraokeStageLayout.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
beforeEach(() => Object.values(apiMocks).forEach((mock) => mock.mockReset()));

describe("async state hooks", () => {
  test("latest and mounted refs track lifecycle", () => {
    const latest = renderHook(({ value }) => useLatestRef(value), {
      initialProps: { value: 1 }
    });
    expect(latest.result.current.current).toBe(1);
    latest.rerender({ value: 2 });
    expect(latest.result.current.current).toBe(2);
    const mounted = renderHook(() => useMountedRef());
    expect(mounted.result.current.current).toBe(true);
    const ref = mounted.result.current;
    mounted.unmount();
    expect(ref.current).toBe(false);
  });

  test("serializes queued actions and survives failures", async () => {
    const { result, unmount } = renderHook(() => useAsyncQueue());
    const order = [];
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let first;
    let second;
    await act(async () => {
      first = result.current.run(async () => {
        order.push(1);
        await gate;
        order.push(2);
        return "a";
      });
      second = result.current.run(() => {
        order.push(3);
        return "b";
      });
      await Promise.resolve();
    });
    expect(result.current.pending).toBe(true);
    release();
    await expect(first).resolves.toBe("a");
    await expect(second).resolves.toBe("b");
    expect(order).toEqual([1, 2, 3]);
    await act(async () => {});
    expect(result.current.pending).toBe(false);
    await expect(result.current.run(null)).rejects.toBeInstanceOf(TypeError);
    await expect(
      result.current.run(() => Promise.reject(new Error("bad")))
    ).rejects.toThrow("bad");
    unmount();
  });

  test("reuses one exclusive action promise", async () => {
    const { result, unmount } = renderHook(() => useExclusiveAsyncAction());
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const action = vi.fn(() => gate);
    let first;
    let second;
    act(() => {
      first = result.current.run(action);
      second = result.current.run(action);
    });
    expect(first).toBe(second);
    expect(result.current.pending).toBe(true);
    release("done");
    await expect(first).resolves.toBe("done");
    await act(async () => {});
    expect(result.current.pending).toBe(false);
    expect(action).toHaveBeenCalledOnce();
    unmount();
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
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.data).toBe(1);
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });
    expect(result.current.error?.message).toBe("offline");
    await act(async () => {
      result.current.refresh();
      await Promise.resolve();
    });
    unmount();
  });

  test("polling resumes on visibility and coalesces overlapping refreshes", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden"
    });
    const visibleFetcher = vi.fn().mockResolvedValue("visible");
    const hidden = renderHook(() => usePolling(visibleFetcher, 100));
    expect(visibleFetcher).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible"
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(hidden.result.current.data).toBe("visible"));
    hidden.unmount();

    let release;
    const first = new Promise((resolve) => {
      release = resolve;
    });
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce("second");
    const polling = renderHook(() => usePolling(fetcher, 0));
    act(() => {
      polling.result.current.refresh();
      polling.result.current.refresh();
    });
    expect(fetcher).toHaveBeenCalledOnce();
    release("first");
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(polling.result.current.data).toBe("second"));
    polling.unmount();
  });
});

describe("navigation and karaoke hooks", () => {
  test("changes settings navigation", () => {
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
    const { result, rerender, unmount } = renderHook(
      ({ enabled }) => useKaraokeControls({ autoHideEnabled: enabled }),
      { initialProps: { enabled: true } }
    );
    act(() => {
      vi.setSystemTime(3000);
      vi.advanceTimersByTime(250);
    });
    expect(result.current.controlsVisible).toBe(false);
    act(() => result.current.revealControls());
    expect(result.current.controlsVisible).toBe(true);
    act(() => result.current.hideControls());
    expect(result.current.controlsVisible).toBe(false);
    fireEventFullscreen();
    expect(result.current.controlsVisible).toBe(true);
    rerender({ enabled: false });
    act(() => result.current.hideControls());
    act(() => result.current.revealControls());
    expect(result.current.controlsVisible).toBe(false);
    unmount();
  });

  test("dispatches scoped karaoke hotkeys", () => {
    const toggle = vi.fn();
    const seek = vi.fn();
    const stop = vi.fn();
    const scope = document.createElement("div");
    document.body.append(scope);
    renderHook(() =>
      useKaraokeHotkeys({
        scopeRef: { current: scope },
        currentTime: 3,
        duration: 6,
        onTogglePlay: toggle,
        onSeek: seek,
        onStop: stop
      })
    );
    for (const code of ["Space", "ArrowLeft", "ArrowRight", "Escape", "KeyA"])
      scope.dispatchEvent(
        new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true })
      );
    expect(toggle).toHaveBeenCalledOnce();
    expect(seek.mock.calls).toEqual([[0], [6]]);
    expect(stop).toHaveBeenCalledOnce();
  });

  test("loads, rejects and resets karaoke results safely", async () => {
    apiMocks.getResult.mockResolvedValueOnce({ notes: [] });
    const { result, rerender, unmount } = renderHook(
      ({ song }) => useKaraokeResult(song),
      {
        initialProps: { song: { id: "one", status: "done", updated_at: 1 } }
      }
    );
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.result).toEqual({ notes: [] }));
    apiMocks.getResult.mockRejectedValueOnce(new Error("bad"));
    rerender({ song: { id: "two", status: "done", updated_at: 2 } });
    await waitFor(() => expect(result.current.error?.message).toBe("bad"));
    rerender({ song: { id: "two", status: "processing", updated_at: 3 } });
    expect(result.current).toEqual({
      result: null,
      loading: false,
      error: null
    });
    unmount();
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
    for (const [node, width, height] of [
      [main, 1000, 700],
      [stage, 800, 450]
    ]) {
      Object.defineProperties(node, {
        clientWidth: { configurable: true, value: width },
        clientHeight: { configurable: true, value: height }
      });
    }
    const disconnect = vi.fn();
    globalThis.ResizeObserver = class {
      constructor(callback) {
        this.callback = callback;
      }
      observe() {
        this.callback();
      }
      disconnect() {
        disconnect();
      }
    };
    const { unmount } = renderHook(() => {
      const stageRef = useRef(stage);
      useKaraokeStageLayout(stageRef);
    });
    expect(stage.style.getPropertyValue("--karaoke-video-width")).toMatch(/px/);
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(stage.style.getPropertyValue("--karaoke-video-width")).toBe("");
    renderHook(() => useKaraokeStageLayout({ current: null }));
  });
});

function fireEventFullscreen() {
  act(() => document.dispatchEvent(new Event("fullscreenchange")));
}
