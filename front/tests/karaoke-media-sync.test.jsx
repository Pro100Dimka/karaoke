/* @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let useKaraokeMediaSync;

const media = ({ currentTime = 0, duration = 100 } = {}) => {
  const element = document.createElement("audio");
  Object.defineProperties(element, {
    currentTime: { configurable: true, writable: true, value: currentTime },
    duration: { configurable: true, value: duration },
    playbackRate: { configurable: true, writable: true, value: 1 },
    volume: { configurable: true, writable: true, value: 1 }
  });
  element.pause = vi.fn();
  return element;
};

const createProps = (overrides = {}) => {
  const instrumental = media({ currentTime: 4, duration: 120 });
  const vocals = media({ currentTime: 0, duration: 100 });
  const video = media({ currentTime: 0, duration: 80 });
  return {
    browserMonitorRef: {
      current: { gainNode: { gain: { value: 0 } }, effects: { apply: vi.fn() } }
    },
    currentTimeRef: { current: 0 },
    instrumentalRef: { current: instrumental },
    isPlaying: false,
    keyShift: 0,
    melodyVolume: 0,
    microphoneEffects: { echo: 0.2 },
    microphoneVolume: 0.7,
    musicVolume: 0.8,
    onPlaybackEndedRef: { current: null },
    setCurrentTime: vi.fn(),
    setDuration: vi.fn(),
    setIsPlaying: vi.fn(),
    silenceMelodyGuide: vi.fn(),
    songId: "song",
    speed: 1.25,
    startMelodyGuide: vi.fn().mockResolvedValue(true),
    updateMelodyGuide: vi.fn(),
    videoRef: { current: video },
    vocalVolume: 0.6,
    vocalsRef: { current: vocals },
    youTubeClipRef: {
      current: {
        src: "https://www.youtube-nocookie.com/embed/id",
        contentWindow: { postMessage: vi.fn() }
      }
    },
    ...overrides
  };
};

beforeEach(async () => {
  vi.resetModules();
  ({ default: useKaraokeMediaSync } =
    await import("../src/pages/Karaoke/hooks/useKaraokeMediaSync"));
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
});

describe("karaoke media synchronization", () => {
  test("applies exact volumes, effects, speed and YouTube commands", () => {
    const props = createProps();
    renderHook(() => useKaraokeMediaSync(props));
    expect(props.instrumentalRef.current.volume).toBeCloseTo(0.64);
    expect(props.vocalsRef.current.volume).toBeCloseTo(0.36);
    expect(props.browserMonitorRef.current.gainNode.gain.value).toBe(0.7);
    expect(props.browserMonitorRef.current.effects.apply).toHaveBeenCalledWith({ echo: 0.2 });
    expect(props.instrumentalRef.current.playbackRate).toBe(1.25);
    expect(props.youTubeClipRef.current.contentWindow.postMessage).toHaveBeenCalledWith(
      JSON.stringify({ event: "command", func: "setPlaybackRate", args: [1.25] }),
      "https://www.youtube-nocookie.com"
    );
    expect(props.silenceMelodyGuide).toHaveBeenCalled();
  });

  test("starts the melody guide while audible playback is active", async () => {
    const props = createProps({ isPlaying: true, melodyVolume: 0.5 });
    renderHook(() => useKaraokeMediaSync(props));
    await act(async () => Promise.resolve());
    expect(props.startMelodyGuide).toHaveBeenCalledOnce();
  });

  test("sends only trusted YouTube commands", () => {
    const props = createProps();
    const { result } = renderHook(() => useKaraokeMediaSync(props));
    expect(result.current.sendYouTubeCommand("  seekTo  ", [2])).toBe(true);
    expect(props.youTubeClipRef.current.contentWindow.postMessage).toHaveBeenLastCalledWith(
      JSON.stringify({ event: "command", func: "seekTo", args: [2] }),
      "https://www.youtube-nocookie.com"
    );
    expect(result.current.sendYouTubeCommand("  ")).toBe(false);
    expect(result.current.sendYouTubeCommand(null)).toBe(false);
    props.youTubeClipRef.current.src = "https://evil.example/embed/id";
    expect(result.current.sendYouTubeCommand("playVideo")).toBe(true);
    expect(props.youTubeClipRef.current.contentWindow.postMessage).toHaveBeenLastCalledWith(
      JSON.stringify({ event: "command", func: "playVideo", args: [] }),
      "https://www.youtube.com"
    );
    props.youTubeClipRef.current.src = "https://www.youtube.com/embed/id";
    expect(result.current.sendYouTubeCommand("playVideo")).toBe(true);
    expect(props.youTubeClipRef.current.contentWindow.postMessage).toHaveBeenLastCalledWith(
      JSON.stringify({ event: "command", func: "playVideo", args: [] }),
      "https://www.youtube.com"
    );
    props.youTubeClipRef.current.src = "not a url";
    expect(result.current.sendYouTubeCommand("pauseVideo")).toBe(true);
    expect(props.youTubeClipRef.current.contentWindow.postMessage).toHaveBeenLastCalledWith(
      JSON.stringify({ event: "command", func: "pauseVideo", args: [] }),
      "https://www.youtube.com"
    );
    props.youTubeClipRef.current = { src: "https://www.youtube.com/embed/id" };
    expect(result.current.sendYouTubeCommand("playVideo")).toBe(false);
    props.youTubeClipRef.current = null;
    expect(result.current.sendYouTubeCommand("playVideo")).toBe(false);
  });

  test("synchronizes finite secondary media and clamps shorter video", () => {
    const props = createProps();
    const { result } = renderHook(() => useKaraokeMediaSync(props));
    act(() => result.current.syncSecondaryMedia(95, true));
    expect(props.vocalsRef.current.currentTime).toBe(95);
    expect(props.videoRef.current.currentTime).toBe(80);
    expect(props.youTubeClipRef.current.contentWindow.postMessage).toHaveBeenCalledWith(
      expect.stringContaining("seekTo"),
      expect.any(String)
    );

    props.vocalsRef.current.currentTime = 94.95;
    act(() => result.current.syncSecondaryMedia(95, false));
    expect(props.vocalsRef.current.currentTime).toBe(94.95);
    props.vocalsRef.current.currentTime = 20;
    props.youTubeClipRef.current.contentWindow.postMessage.mockClear();
    act(() => result.current.syncSecondaryMedia(22));
    expect(props.vocalsRef.current.currentTime).toBe(22);
    expect(props.youTubeClipRef.current.contentWindow.postMessage).not.toHaveBeenCalled();
    Object.defineProperty(props.videoRef.current, "duration", {
      configurable: true,
      value: Number.NaN
    });
    act(() => result.current.syncSecondaryMedia(20));
    expect(props.videoRef.current.currentTime).toBe(22);
  });

  test("skips unusable secondary media and isolates detached setters", () => {
    const props = createProps();
    Object.defineProperty(props.vocalsRef.current, "duration", { configurable: true, value: 0 });
    Object.defineProperty(props.videoRef.current, "duration", { configurable: true, value: -1 });
    const { result } = renderHook(() => useKaraokeMediaSync(props));
    act(() => result.current.syncSecondaryMedia(8));
    expect(props.vocalsRef.current.currentTime).toBe(0);
    expect(props.videoRef.current.currentTime).toBe(0);

    const currentTime = 0;
    Object.defineProperties(props.vocalsRef.current, {
      duration: { configurable: true, value: 100 },
      currentTime: {
        configurable: true,
        get: () => currentTime,
        set: () => {
          throw new Error("detached");
        }
      }
    });
    expect(() => act(() => result.current.syncSecondaryMedia(9, true))).not.toThrow();
    expect(currentTime).toBe(0);
    expect(props.youTubeClipRef.current.contentWindow.postMessage).toHaveBeenLastCalledWith(
      JSON.stringify({ event: "command", func: "seekTo", args: [9, true] }),
      "https://www.youtube-nocookie.com"
    );
  });

  test("tracks metadata and performs default end cleanup", () => {
    const props = createProps();
    const add = vi.spyOn(props.instrumentalRef.current, "addEventListener");
    const remove = vi.spyOn(props.instrumentalRef.current, "removeEventListener");
    const hook = renderHook(() => useKaraokeMediaSync(props));
    expect(add.mock.calls.map(([event]) => event)).toEqual([
      "loadedmetadata",
      "durationchange",
      "ended",
      "timeupdate"
    ]);
    expect(props.setDuration).toHaveBeenCalledWith(120);
    act(() => props.instrumentalRef.current.dispatchEvent(new Event("durationchange")));
    Object.defineProperty(props.instrumentalRef.current, "duration", {
      configurable: true,
      value: Number.NaN
    });
    act(() => props.instrumentalRef.current.dispatchEvent(new Event("durationchange")));
    expect(props.setDuration).toHaveBeenLastCalledWith(0);
    Object.defineProperty(props.instrumentalRef.current, "duration", {
      configurable: true,
      value: 0
    });
    act(() => props.instrumentalRef.current.dispatchEvent(new Event("durationchange")));
    expect(props.setDuration).toHaveBeenLastCalledWith(0);
    Object.defineProperty(props.instrumentalRef.current, "duration", {
      configurable: true,
      value: -1
    });
    act(() => props.instrumentalRef.current.dispatchEvent(new Event("loadedmetadata")));
    expect(props.setDuration).toHaveBeenLastCalledWith(0);
    act(() => props.instrumentalRef.current.dispatchEvent(new Event("ended")));
    expect(props.vocalsRef.current.pause).toHaveBeenCalled();
    expect(props.videoRef.current.pause).toHaveBeenCalled();
    expect(props.sendYouTubeCommand).toBeUndefined();
    expect(props.youTubeClipRef.current.contentWindow.postMessage).toHaveBeenLastCalledWith(
      JSON.stringify({ event: "command", func: "pauseVideo", args: [] }),
      "https://www.youtube-nocookie.com"
    );
    expect(props.silenceMelodyGuide).toHaveBeenCalled();
    expect(props.setIsPlaying).toHaveBeenCalledWith(false);
    hook.unmount();
    expect(remove.mock.calls.map(([event]) => event)).toEqual([
      "loadedmetadata",
      "durationchange",
      "ended",
      "timeupdate"
    ]);
  });

  test("handles an ended master without optional secondary media", () => {
    const props = createProps({ vocalsRef: { current: null }, videoRef: { current: null } });
    renderHook(() => useKaraokeMediaSync(props));
    expect(() =>
      act(() => props.instrumentalRef.current.dispatchEvent(new Event("ended")))
    ).not.toThrow();
    expect(props.setIsPlaying).toHaveBeenCalledWith(false);
  });

  test("delegates end handling when the parent supplies a callback", async () => {
    const ended = vi.fn().mockRejectedValue(new Error("already stopped"));
    const props = createProps({ onPlaybackEndedRef: { current: ended } });
    renderHook(() => useKaraokeMediaSync(props));
    act(() => props.instrumentalRef.current.dispatchEvent(new Event("ended")));
    await act(async () => Promise.resolve());
    expect(ended).toHaveBeenCalledOnce();
    expect(props.setIsPlaying).not.toHaveBeenCalled();
  });

  test("publishes master time from native timeupdate events", () => {
    const props = createProps();
    renderHook(() => useKaraokeMediaSync(props));
    props.setCurrentTime.mockClear();
    props.instrumentalRef.current.currentTime = 12.5;
    act(() => props.instrumentalRef.current.dispatchEvent(new Event("timeupdate")));
    expect(props.currentTimeRef.current).toBe(12.5);
    expect(props.setCurrentTime).toHaveBeenCalledWith(12.5);
  });

  test("publishes master time from animation frames", () => {
    let frame;
    requestAnimationFrame.mockImplementation((callback) => {
      frame = callback;
      return 7;
    });
    const now = vi.spyOn(performance, "now").mockReturnValue(450);
    const props = createProps({ isPlaying: true });
    const hook = renderHook(() => useKaraokeMediaSync(props));
    expect(props.setCurrentTime).toHaveBeenCalledWith(4);
    expect(props.updateMelodyGuide).toHaveBeenCalledWith(4);
    expect(props.vocalsRef.current.currentTime).toBe(0);
    now.mockReturnValue(451);
    props.instrumentalRef.current.currentTime = 5;
    act(() => frame());
    expect(props.currentTimeRef.current).toBe(5);
    expect(props.setCurrentTime).toHaveBeenCalledWith(5);
    expect(props.vocalsRef.current.currentTime).toBe(5);
    const syncCount = props.youTubeClipRef.current.contentWindow.postMessage.mock.calls.length;
    props.instrumentalRef.current.currentTime = 0;
    props.vocalsRef.current.currentTime = 20;
    now.mockReturnValue(900);
    act(() => frame());
    expect(props.setCurrentTime).toHaveBeenLastCalledWith(0);
    expect(props.vocalsRef.current.currentTime).toBe(20);
    expect(props.youTubeClipRef.current.contentWindow.postMessage).toHaveBeenCalledTimes(syncCount);
    props.instrumentalRef.current.currentTime = Number.NaN;
    act(() => frame());
    expect(props.setCurrentTime).toHaveBeenCalledTimes(3);
    props.instrumentalRef.current.currentTime = -1;
    act(() => frame());
    expect(props.setCurrentTime).toHaveBeenCalledTimes(3);
    const scheduledBeforeUnmount = requestAnimationFrame.mock.calls.length;
    hook.unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
    act(() => frame());
    expect(requestAnimationFrame).toHaveBeenCalledTimes(scheduledBeforeUnmount);
  });

  test("tolerates missing instrumental media and animation scheduling", () => {
    const props = createProps({ isPlaying: true });
    props.instrumentalRef.current = null;
    vi.stubGlobal("requestAnimationFrame", undefined);
    expect(() => renderHook(() => useKaraokeMediaSync(props))).not.toThrow();
  });

  test("does not schedule position frames while playback is paused", () => {
    const props = createProps({ isPlaying: false });
    const hook = renderHook((value) => useKaraokeMediaSync(value), { initialProps: props });
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    hook.rerender({ ...props, isPlaying: true });
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
  });

  test("tolerates a missing master during an otherwise active frame loop", () => {
    const props = createProps({ isPlaying: true });
    props.instrumentalRef.current = null;
    expect(() => renderHook(() => useKaraokeMediaSync(props))).not.toThrow();
    expect(props.setCurrentTime).not.toHaveBeenCalled();
  });

  test("falls back to wall-clock time and tolerates an unscheduled frame", () => {
    let frame;
    vi.stubGlobal("performance", undefined);
    requestAnimationFrame.mockImplementation((callback) => {
      frame = callback;
      return undefined;
    });
    const props = createProps({ isPlaying: true });
    const hook = renderHook(() => useKaraokeMediaSync(props));
    hook.unmount();
    act(() => frame());
    expect(cancelAnimationFrame).not.toHaveBeenCalled();
  });

  test("falls back to wall-clock time when performance has no now function", () => {
    vi.stubGlobal("performance", {});
    const props = createProps({ isPlaying: true });
    expect(() => renderHook(() => useKaraokeMediaSync(props))).not.toThrow();
    expect(props.setCurrentTime).toHaveBeenCalledWith(4);
  });

  test("falls back to safe rates and tolerates missing monitor/media nodes", async () => {
    const props = createProps({
      speed: "bad",
      microphoneVolume: "bad",
      browserMonitorRef: { current: null },
      vocalsRef: { current: null },
      videoRef: { current: null },
      isPlaying: true,
      melodyVolume: 1,
      startMelodyGuide: vi.fn().mockRejectedValue(new Error("blocked"))
    });
    renderHook(() => useKaraokeMediaSync(props));
    await act(async () => Promise.resolve());
    expect(props.instrumentalRef.current.playbackRate).toBe(1);
  });

  test("clamps media rates and microphone gain at both boundaries", () => {
    const props = createProps({ speed: 0.01, microphoneVolume: -2 });
    const hook = renderHook((value) => useKaraokeMediaSync(value), { initialProps: props });
    expect(props.instrumentalRef.current.playbackRate).toBe(0.25);
    expect(props.browserMonitorRef.current.gainNode.gain.value).toBe(0);
    hook.rerender({ ...props, speed: 8, microphoneVolume: 5 });
    expect(props.instrumentalRef.current.playbackRate).toBe(4);
    expect(props.browserMonitorRef.current.gainNode.gain.value).toBe(1);
    hook.rerender({ ...props, speed: 0, microphoneVolume: Number.NaN });
    expect(props.instrumentalRef.current.playbackRate).toBe(1);
    expect(props.browserMonitorRef.current.gainNode.gain.value).toBe(1);
    hook.rerender({ ...props, speed: Number.POSITIVE_INFINITY });
    expect(props.instrumentalRef.current.playbackRate).toBe(1);
  });

  test("tolerates partially constructed browser monitor nodes", () => {
    for (const current of [{}, { gainNode: {} }, { effects: {} }]) {
      const props = createProps({ browserMonitorRef: { current } });
      // Each iteration verifies an independent partial node.
      // eslint-disable-next-line no-loop-func
      expect(() => renderHook(() => useKaraokeMediaSync(props))).not.toThrow();
    }
  });

  test("reacts to every mutable media setting without touching unrelated state", () => {
    const props = createProps();
    const hook = renderHook((value) => useKaraokeMediaSync(value), { initialProps: props });
    const nextEffects = { reverb: 0.9 };
    hook.rerender({
      ...props,
      musicVolume: 0.5,
      vocalVolume: 0.4,
      microphoneVolume: 0.25,
      microphoneEffects: nextEffects,
      speed: 2
    });
    expect(props.instrumentalRef.current.volume).toBe(0.25);
    expect(props.vocalsRef.current.volume).toBeCloseTo(0.16);
    expect(props.browserMonitorRef.current.gainNode.gain.value).toBe(0.25);
    expect(props.browserMonitorRef.current.effects.apply).toHaveBeenLastCalledWith(nextEffects);
    expect(props.videoRef.current.playbackRate).toBe(2);
  });

  test("refreshes callback closures and media listeners when their identities change", () => {
    const props = createProps();
    const hook = renderHook((value) => useKaraokeMediaSync(value), { initialProps: props });
    const nextWindow = { postMessage: vi.fn() };
    const nextYouTubeRef = {
      current: {
        src: "https://www.youtube.com/embed/next",
        contentWindow: nextWindow
      }
    };
    const nextVocals = media({ currentTime: 0, duration: 30 });
    const nextVideo = media({ currentTime: 0, duration: 30 });
    const nextInstrumental = media({ currentTime: 2, duration: 40 });
    const nextInstrumentalRef = { current: nextInstrumental };
    hook.rerender({
      ...props,
      songId: "next-song",
      instrumentalRef: nextInstrumentalRef,
      vocalsRef: { current: nextVocals },
      videoRef: { current: nextVideo },
      youTubeClipRef: nextYouTubeRef
    });
    act(() => hook.result.current.syncSecondaryMedia(7, true));
    expect(nextVocals.currentTime).toBe(7);
    expect(nextVideo.currentTime).toBe(7);
    expect(nextWindow.postMessage).toHaveBeenLastCalledWith(
      JSON.stringify({ event: "command", func: "seekTo", args: [7, true] }),
      "https://www.youtube.com"
    );
    act(() => nextInstrumental.dispatchEvent(new Event("durationchange")));
    expect(props.setDuration).toHaveBeenLastCalledWith(40);
  });

  test("silences the melody guide when playback or guide volume becomes inactive", async () => {
    const props = createProps({ isPlaying: true, melodyVolume: 0.5 });
    const hook = renderHook((value) => useKaraokeMediaSync(value), { initialProps: props });
    await act(async () => Promise.resolve());
    props.silenceMelodyGuide.mockClear();
    hook.rerender({ ...props, isPlaying: false });
    expect(props.silenceMelodyGuide).toHaveBeenCalledOnce();
    props.silenceMelodyGuide.mockClear();
    hook.rerender({ ...props, melodyVolume: 0 });
    expect(props.silenceMelodyGuide).toHaveBeenCalledOnce();
  });
});
