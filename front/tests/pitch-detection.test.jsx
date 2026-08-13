/* @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ detectMidiFromAnalyser: vi.fn() }));
vi.mock("../src/pages/Karaoke/utils/pitch", () => ({
  detectMidiFromAnalyser: mocks.detectMidiFromAnalyser
}));

import usePitchDetection from "../src/pages/Karaoke/hooks/usePitchDetection.js";

let frames;
beforeEach(() => {
  frames = [];
  mocks.detectMidiFromAnalyser.mockReset();
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback) => {
      frames.push(callback);
      return frames.length;
    })
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: undefined
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.AudioContext;
  delete window.webkitAudioContext;
});

const createAudio = ({ state = "running" } = {}) => {
  const analyser = { fftSize: 0, smoothingTimeConstant: 0.2 };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const context = {
    state,
    sampleRate: 48000,
    createAnalyser: () => analyser,
    createMediaStreamSource: () => source,
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined)
  };
  const track = { readyState: "live", stop: vi.fn() };
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track]
  };
  return { analyser, source, context, stream, track };
};

const props = (overrides = {}) => ({
  browserMonitorRef: { current: null },
  isPlaying: true,
  monitorInputDeviceId: "default",
  monitoringEnabled: true,
  ...overrides
});

describe("pitch detection", () => {
  test("stays reset while playback or media capture is unavailable", () => {
    const hook = renderHook((value) => usePitchDetection(value), {
      initialProps: props({ isPlaying: false })
    });
    expect(hook.result.current).toEqual({
      sungMidi: null,
      isPitchDetected: false,
      isPitchAttacking: false,
      pitchRestProgress: 1
    });
    hook.rerender(props({ isPlaying: true }));
    expect(frames).toEqual([]);
  });

  test("tracks attack, smoothed pitch and the complete rest transition", async () => {
    const audio = createAudio();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() }
    });
    mocks.detectMidiFromAnalyser
      .mockReturnValueOnce(69)
      .mockReturnValueOnce(70)
      .mockReturnValue(null);
    const hook = renderHook(() =>
      usePitchDetection(
        props({
          browserMonitorRef: {
            current: { stream: audio.stream, context: audio.context }
          }
        })
      )
    );
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    for (const timestamp of [40, 100, 160, 230, 650]) {
      const frame = frames.shift();
      act(() => frame(timestamp));
    }
    expect(hook.result.current.sungMidi).toBeNull();
    expect(hook.result.current.isPitchDetected).toBe(false);
    expect(hook.result.current.isPitchAttacking).toBe(false);
    expect(hook.result.current.pitchRestProgress).toBe(1);
    expect(audio.source.connect).toHaveBeenCalledWith(audio.analyser);
    hook.unmount();
    expect(audio.source.disconnect).toHaveBeenCalled();
  });

  test("requests a preferred microphone, falls back and owns its audio graph", async () => {
    const audio = createAudio({ state: "suspended" });
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new Error("preferred unavailable"))
      .mockResolvedValueOnce(audio.stream);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia }
    });
    window.AudioContext = class {
      constructor(options) {
        audio.context.options = options;
        return audio.context;
      }
    };
    const hook = renderHook(() =>
      usePitchDetection(props({ monitorInputDeviceId: "usb-mic" }))
    );
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[0][0].audio.deviceId).toEqual({
      exact: "usb-mic"
    });
    expect(audio.context.resume).toHaveBeenCalled();
    hook.unmount();
    expect(audio.track.stop).toHaveBeenCalled();
    expect(audio.context.close).toHaveBeenCalled();
  });

  test("resets safely after capture or Web Audio failures", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockRejectedValue(new Error("permission denied"))
      }
    });
    const capture = renderHook(() => usePitchDetection(props()));
    await act(async () => Promise.resolve());
    expect(capture.result.current.sungMidi).toBeNull();
    capture.unmount();

    const audio = createAudio({ state: "suspended" });
    audio.context.resume.mockRejectedValue(new Error("resume denied"));
    const resume = renderHook(() =>
      usePitchDetection(
        props({
          browserMonitorRef: {
            current: { stream: audio.stream, context: audio.context }
          }
        })
      )
    );
    await act(async () => Promise.resolve());
    expect(resume.result.current.isPitchDetected).toBe(false);
  });

  test("releases resources when capture resolves after unmount", async () => {
    const audio = createAudio();
    let resolveStream;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(
          () =>
            new Promise((resolve) => {
              resolveStream = resolve;
            })
        )
      }
    });
    window.AudioContext = class {
      constructor() {
        return audio.context;
      }
    };
    const hook = renderHook(() => usePitchDetection(props()));
    await waitFor(() => expect(resolveStream).toBeTypeOf("function"));
    hook.unmount();
    await act(async () => resolveStream(audio.stream));
    expect(audio.track.stop).toHaveBeenCalled();
  });
});
