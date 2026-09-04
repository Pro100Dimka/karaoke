/* @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { same, called, calledWith, verify } from "./helpers/assertions.mjs";
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
    currentTimeRef: { current: 0 },
    instrumentalRef: { current: instrumental },
    isPlaying: false,
    keyShift: 0,
    melodyVolume: 0,
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
  ({ default: useKaraokeMediaSync } = await import("../src/pages/Karaoke/hooks/useKaraokeMediaSync"));
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
    verify(
      [props.instrumentalRef.current.volume, "toBeCloseTo", 0.64],
      [props.vocalsRef.current.volume, "toBeCloseTo", 0.36],
      [props.instrumentalRef.current.playbackRate, "toBe", 1.25]
    );
    verify([
      props.youTubeClipRef.current.contentWindow.postMessage,
      "toHaveBeenCalledWith",
      JSON.stringify({ event: "command", func: "setPlaybackRate", args: [1.25] }),
      "https://www.youtube-nocookie.com"
    ]);
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
    verify([
      props.youTubeClipRef.current.contentWindow.postMessage,
      "toHaveBeenLastCalledWith",
      JSON.stringify({ event: "command", func: "seekTo", args: [2] }),
      "https://www.youtube-nocookie.com"
    ]);
    same([result.current.sendYouTubeCommand("  "), false], [result.current.sendYouTubeCommand(null), false]);
    props.youTubeClipRef.current.src = "https://evil.example/embed/id";
    expect(result.current.sendYouTubeCommand("playVideo")).toBe(true);
    verify([
      props.youTubeClipRef.current.contentWindow.postMessage,
      "toHaveBeenLastCalledWith",
      JSON.stringify({ event: "command", func: "playVideo", args: [] }),
      "https://www.youtube.com"
    ]);
    props.youTubeClipRef.current.src = "https://www.youtube.com/embed/id";
    expect(result.current.sendYouTubeCommand("playVideo")).toBe(true);
    verify([
      props.youTubeClipRef.current.contentWindow.postMessage,
      "toHaveBeenLastCalledWith",
      JSON.stringify({ event: "command", func: "playVideo", args: [] }),
      "https://www.youtube.com"
    ]);
    props.youTubeClipRef.current.src = "not a url";
    expect(result.current.sendYouTubeCommand("pauseVideo")).toBe(true);
    verify([
      props.youTubeClipRef.current.contentWindow.postMessage,
      "toHaveBeenLastCalledWith",
      JSON.stringify({ event: "command", func: "pauseVideo", args: [] }),
      "https://www.youtube.com"
    ]);
    props.youTubeClipRef.current = { src: "https://www.youtube.com/embed/id" };
    expect(result.current.sendYouTubeCommand("playVideo")).toBe(false);
    props.youTubeClipRef.current = null;
    expect(result.current.sendYouTubeCommand("playVideo")).toBe(false);
  });
  test("synchronizes finite secondary media and clamps shorter video", () => {
    const props = createProps();
    const { result } = renderHook(() => useKaraokeMediaSync(props));
    act(() => result.current.syncSecondaryMedia(95, true));
    same([props.vocalsRef.current.currentTime, 95], [props.videoRef.current.currentTime, 80]);
    verify([
      props.youTubeClipRef.current.contentWindow.postMessage,
      "toHaveBeenCalledWith",
      expect.stringContaining("seekTo"),
      expect.any(String)
    ]);
    props.vocalsRef.current.currentTime = 94.95;
    act(() => result.current.syncSecondaryMedia(95, false));
    expect(props.vocalsRef.current.currentTime).toBe(94.95);
    props.vocalsRef.current.currentTime = 20;
    props.youTubeClipRef.current.contentWindow.postMessage.mockClear();
    act(() => result.current.syncSecondaryMedia(22));
    verify(
      [props.vocalsRef.current.currentTime, "toBe", 22],
      [props.youTubeClipRef.current.contentWindow.postMessage, "not.toHaveBeenCalled"]
    );
    Object.defineProperty(props.videoRef.current, "duration", {
      configurable: true,
      value: Number.NaN
    });
    act(() => result.current.syncSecondaryMedia(20));
    expect(props.videoRef.current.currentTime).toBe(22);
  });
  test("forces an immediate resync when the tab becomes visible again", () => {
    const props = createProps({ isPlaying: true });
    props.instrumentalRef.current.currentTime = 42;
    props.vocalsRef.current.currentTime = 10; // left stale by throttled rAF while hidden
    renderHook(() => useKaraokeMediaSync(props));
    props.setCurrentTime.mockClear();

    document.dispatchEvent(new Event("visibilitychange"));

    expect(props.setCurrentTime).toHaveBeenCalledWith(42);
    expect(props.vocalsRef.current.currentTime).toBe(42);
    verify([
      props.youTubeClipRef.current.contentWindow.postMessage,
      "toHaveBeenLastCalledWith",
      expect.stringContaining("seekTo"),
      expect.any(String)
    ]);
  });
  test("nudges playbackRate for small drift instead of seeking, and hard-seeks past the strong band", () => {
    const props = createProps();
    const { result } = renderHook(() => useKaraokeMediaSync(props));
    const vocals = props.vocalsRef.current;

    // 50ms behind (soft band, 20-80ms): small positive rate nudge, no seek.
    vocals.currentTime = 9.95;
    act(() => result.current.syncSecondaryMedia(10));
    expect(vocals.currentTime).toBe(9.95);
    expect(vocals.playbackRate).toBeCloseTo(1.25 * 1.02, 5);

    // 150ms ahead (strong band, 80-250ms): larger negative rate nudge, no seek.
    vocals.currentTime = 10.15;
    act(() => result.current.syncSecondaryMedia(10));
    expect(vocals.currentTime).toBe(10.15);
    expect(vocals.playbackRate).toBeCloseTo(1.25 * 0.94, 5);

    // Back within 20ms: rate returns to the plain speed setting.
    vocals.currentTime = 10.01;
    act(() => result.current.syncSecondaryMedia(10));
    expect(vocals.currentTime).toBe(10.01);
    expect(vocals.playbackRate).toBeCloseTo(1.25, 5);

    // 2s off (past the 250ms strong band): hard seek, rate back to normal.
    vocals.playbackRate = 1.31;
    vocals.currentTime = 8;
    act(() => result.current.syncSecondaryMedia(10));
    expect(vocals.currentTime).toBe(10);
    expect(vocals.playbackRate).toBeCloseTo(1.25, 5);
  });
  test("skips unusable secondary media and isolates detached setters", () => {
    const props = createProps();
    Object.defineProperty(props.vocalsRef.current, "duration", { configurable: true, value: 0 });
    Object.defineProperty(props.videoRef.current, "duration", { configurable: true, value: -1 });
    const { result } = renderHook(() => useKaraokeMediaSync(props));
    act(() => result.current.syncSecondaryMedia(8));
    same([props.vocalsRef.current.currentTime, 0], [props.videoRef.current.currentTime, 0]);
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
    verify([
      props.youTubeClipRef.current.contentWindow.postMessage,
      "toHaveBeenLastCalledWith",
      JSON.stringify({ event: "command", func: "seekTo", args: [9, true] }),
      "https://www.youtube-nocookie.com"
    ]);
  });
  test("tracks metadata and performs default end cleanup", () => {
    const props = createProps();
    const add = vi.spyOn(props.instrumentalRef.current, "addEventListener");
    const remove = vi.spyOn(props.instrumentalRef.current, "removeEventListener");
    const hook = renderHook(() => useKaraokeMediaSync(props));
    verify([add.mock.calls.map(([event]) => event), "toEqual", ["loadedmetadata", "durationchange", "ended", "timeupdate"]]);
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
    called(props.vocalsRef.current.pause, props.videoRef.current.pause);
    expect(props.sendYouTubeCommand).toBeUndefined();
    verify([
      props.youTubeClipRef.current.contentWindow.postMessage,
      "toHaveBeenLastCalledWith",
      JSON.stringify({ event: "command", func: "pauseVideo", args: [] }),
      "https://www.youtube-nocookie.com"
    ]);
    verify([props.silenceMelodyGuide, "toHaveBeenCalled"], [props.setIsPlaying, "toHaveBeenCalledWith", false]);
    hook.unmount();
    verify([remove.mock.calls.map(([event]) => event), "toEqual", ["loadedmetadata", "durationchange", "ended", "timeupdate"]]);
  });
  test("handles an ended master without optional secondary media", () => {
    const props = createProps({ vocalsRef: { current: null }, videoRef: { current: null } });
    renderHook(() => useKaraokeMediaSync(props));
    verify([() => act(() => props.instrumentalRef.current.dispatchEvent(new Event("ended"))), "not.toThrow"]);
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
    verify([props.currentTimeRef.current, "toBe", 12.5], [props.setCurrentTime, "toHaveBeenCalledWith", 12.5]);
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
    calledWith([props.setCurrentTime, [4]], [props.updateMelodyGuide, [4]]);
    expect(props.vocalsRef.current.currentTime).toBe(0);
    // setCurrentTime is throttled to once per REACT_SYNC_INTERVAL_MS (100ms)
    // -- currentTimeRef and updateMelodyGuide still update every frame, but
    // the react-state publish only fires once that interval has elapsed.
    now.mockReturnValue(551);
    props.instrumentalRef.current.currentTime = 5;
    act(() => frame());
    verify(
      [props.currentTimeRef.current, "toBe", 5],
      [props.setCurrentTime, "toHaveBeenCalledWith", 5],
      [props.vocalsRef.current.currentTime, "toBe", 5]
    );
    const syncCount = props.youTubeClipRef.current.contentWindow.postMessage.mock.calls.length;
    props.instrumentalRef.current.currentTime = 0;
    props.vocalsRef.current.currentTime = 20;
    now.mockReturnValue(900);
    act(() => frame());
    expect(props.setCurrentTime).toHaveBeenLastCalledWith(0);
    verify(
      [props.vocalsRef.current.currentTime, "toBe", 20],
      [props.youTubeClipRef.current.contentWindow.postMessage, "toHaveBeenCalledTimes", syncCount]
    );
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
  test("retries attaching duration/timeupdate listeners until the <audio> element mounts", () => {
    // Karaoke/index.jsx can render this hook's effect before <KaraokeMedia>
    // (and its <audio ref={instrumentalRef}>) has actually mounted -- the
    // song result can finish loading on a later render than songId first
    // resolving. Giving up permanently on that one null check silently
    // starved duration/timeupdate forever; this proves the retry loop picks
    // the element up once it appears instead.
    const props = createProps();
    const instrumental = props.instrumentalRef.current;
    props.instrumentalRef.current = null;
    let rafCallback;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback) => {
        rafCallback = callback;
        return 1;
      })
    );
    renderHook(() => useKaraokeMediaSync(props));
    expect(props.setDuration).not.toHaveBeenCalled();
    props.instrumentalRef.current = instrumental;
    act(() => rafCallback());
    expect(props.setDuration).toHaveBeenCalledWith(120);
    props.setCurrentTime.mockClear();
    instrumental.currentTime = 33;
    act(() => instrumental.dispatchEvent(new Event("timeupdate")));
    expect(props.setCurrentTime).toHaveBeenCalledWith(33);
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
  test("falls back to safe rates and tolerates missing media nodes", async () => {
    const props = createProps({
      speed: "bad",
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
  test("clamps media rates at both boundaries", () => {
    const props = createProps({ speed: 0.01 });
    const hook = renderHook((value) => useKaraokeMediaSync(value), { initialProps: props });
    expect(props.instrumentalRef.current.playbackRate).toBe(0.25);
    hook.rerender({ ...props, speed: 8 });
    expect(props.instrumentalRef.current.playbackRate).toBe(4);
    hook.rerender({ ...props, speed: 0 });
    expect(props.instrumentalRef.current.playbackRate).toBe(1);
    hook.rerender({ ...props, speed: Number.POSITIVE_INFINITY });
    expect(props.instrumentalRef.current.playbackRate).toBe(1);
  });
  test("reacts to every mutable media setting without touching unrelated state", () => {
    const props = createProps();
    const hook = renderHook((value) => useKaraokeMediaSync(value), { initialProps: props });
    hook.rerender({
      ...props,
      musicVolume: 0.5,
      vocalVolume: 0.4,
      speed: 2
    });
    verify(
      [props.instrumentalRef.current.volume, "toBe", 0.25],
      [props.vocalsRef.current.volume, "toBeCloseTo", 0.16],
      [props.videoRef.current.playbackRate, "toBe", 2]
    );
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
    same([nextVocals.currentTime, 7], [nextVideo.currentTime, 7]);
    verify([
      nextWindow.postMessage,
      "toHaveBeenLastCalledWith",
      JSON.stringify({ event: "command", func: "seekTo", args: [7, true] }),
      "https://www.youtube.com"
    ]);
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
