/* @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import useKaraokeMediaSync from "../src/pages/Karaoke/hooks/useKaraokeMediaSync.js";

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
      current: {
        gainNode: { gain: { value: 0 } },
        effects: { apply: vi.fn() }
      }
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

beforeEach(() => {
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
  test("applies volumes, effects, speed and YouTube commands", () => {
    const props = createProps();
    renderHook(() => useKaraokeMediaSync(props));
    expect(props.instrumentalRef.current.volume).toBeGreaterThan(0);
    expect(props.vocalsRef.current.volume).toBeGreaterThan(0);
    expect(props.browserMonitorRef.current.gainNode.gain.value).toBe(0.7);
    expect(props.browserMonitorRef.current.effects.apply).toHaveBeenCalledWith({
      echo: 0.2
    });
    expect(props.instrumentalRef.current.playbackRate).toBe(1.25);
    expect(
      props.youTubeClipRef.current.contentWindow.postMessage
    ).toHaveBeenCalledWith(
      expect.stringContaining("setPlaybackRate"),
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
    expect(
      props.youTubeClipRef.current.contentWindow.postMessage
    ).toHaveBeenLastCalledWith(
      JSON.stringify({ event: "command", func: "seekTo", args: [2] }),
      "https://www.youtube-nocookie.com"
    );
    expect(result.current.sendYouTubeCommand("  ")).toBe(false);
    props.youTubeClipRef.current = null;
    expect(result.current.sendYouTubeCommand("playVideo")).toBe(false);
  });

  test("synchronizes finite secondary media and clamps shorter video", () => {
    const props = createProps();
    const { result } = renderHook(() => useKaraokeMediaSync(props));
    act(() => result.current.syncSecondaryMedia(95, true));
    expect(props.vocalsRef.current.currentTime).toBe(95);
    expect(props.videoRef.current.currentTime).toBe(80);
    expect(
      props.youTubeClipRef.current.contentWindow.postMessage
    ).toHaveBeenCalledWith(
      expect.stringContaining("seekTo"),
      expect.any(String)
    );

    props.vocalsRef.current.currentTime = 94.95;
    act(() => result.current.syncSecondaryMedia(95, false));
    expect(props.vocalsRef.current.currentTime).toBe(94.95);
    Object.defineProperty(props.videoRef.current, "duration", {
      configurable: true,
      value: Number.NaN
    });
    act(() => result.current.syncSecondaryMedia(20));
  });

  test("tracks metadata and performs default end cleanup", () => {
    const props = createProps();
    const hook = renderHook(() => useKaraokeMediaSync(props));
    expect(props.setDuration).toHaveBeenCalledWith(120);
    act(() =>
      props.instrumentalRef.current.dispatchEvent(new Event("durationchange"))
    );
    Object.defineProperty(props.instrumentalRef.current, "duration", {
      configurable: true,
      value: Number.NaN
    });
    act(() =>
      props.instrumentalRef.current.dispatchEvent(new Event("durationchange"))
    );
    expect(props.setDuration).toHaveBeenLastCalledWith(0);
    act(() => props.instrumentalRef.current.dispatchEvent(new Event("ended")));
    expect(props.vocalsRef.current.pause).toHaveBeenCalled();
    expect(props.videoRef.current.pause).toHaveBeenCalled();
    expect(props.setIsPlaying).toHaveBeenCalledWith(false);
    hook.unmount();
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

  test("publishes master time from animation frames", () => {
    let frame;
    requestAnimationFrame.mockImplementation((callback) => {
      frame = callback;
      return 7;
    });
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const props = createProps({ isPlaying: true });
    const hook = renderHook(() => useKaraokeMediaSync(props));
    expect(props.setCurrentTime).toHaveBeenCalledWith(4);
    expect(props.updateMelodyGuide).toHaveBeenCalledWith(4);
    props.instrumentalRef.current.currentTime = 5;
    act(() => frame());
    expect(props.currentTimeRef.current).toBe(5);
    expect(props.setCurrentTime).toHaveBeenCalledWith(5);
    hook.unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
    act(() => frame());
  });

  test("tolerates missing instrumental media and animation scheduling", () => {
    const props = createProps({ isPlaying: true });
    props.instrumentalRef.current = null;
    vi.stubGlobal("requestAnimationFrame", undefined);
    expect(() => renderHook(() => useKaraokeMediaSync(props))).not.toThrow();
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
});
