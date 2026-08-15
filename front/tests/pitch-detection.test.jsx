/* @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ detectMidiFromAnalyser: vi.fn() }));
vi.mock("../src/pages/Karaoke/utils/pitch", () => ({
  detectMidiFromAnalyser: mocks.detectMidiFromAnalyser
}));

let usePitchDetection;

let frames;
beforeEach(async () => {
  vi.resetModules();
  ({ default: usePitchDetection } =
    await import("../src/pages/Karaoke/hooks/usePitchDetection"));
  frames = [];
  mocks.detectMidiFromAnalyser.mockReset();
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback) => { frames.push(callback); return frames.length; })
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
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
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  return { analyser, source, context, stream, track };
};

const props = (overrides = {}) => ({
  browserMonitorRef: { current: null },
  isPlaying: true,
  monitorInputDeviceId: "default",
  monitoringEnabled: true,
  ...overrides
});
const installAudioContext = (audio) => {
  // Constructor mocks must use a constructable function for Vitest.
  // eslint-disable-next-line prefer-arrow-callback
  window.AudioContext = vi.fn(function AudioContext(options) {
    audio.context.options = options;
    return audio.context;
  });
};

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

  test("never initializes audio while playback is paused", async () => {
    const audio = createAudio();
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    const hook = renderHook(() =>
      usePitchDetection(
        props({
          isPlaying: false,
          browserMonitorRef: { current: { stream: audio.stream, context: audio.context } }
        })
      )
    );
    await act(async () => Promise.resolve());
    expect(frames).toEqual([]);
    expect(getUserMedia).not.toHaveBeenCalled();
    hook.unmount();
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
    const input = props({
      browserMonitorRef: { current: { stream: audio.stream, context: audio.context } }
    });
    const hook = renderHook(() => usePitchDetection(input));
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    const expected = [
      { sungMidi: 69, isPitchDetected: true, isPitchAttacking: true, pitchRestProgress: 0 },
      { sungMidi: 69.42, isPitchDetected: true, isPitchAttacking: true, pitchRestProgress: 0 },
      { sungMidi: 69.42, isPitchDetected: true, isPitchAttacking: true, pitchRestProgress: 0 },
      { sungMidi: 69.42, isPitchDetected: false, isPitchAttacking: false, pitchRestProgress: 0 },
      { sungMidi: null, isPitchDetected: false, isPitchAttacking: false, pitchRestProgress: 1 }
    ];
    for (const [index, timestamp] of [40, 100, 160, 230, 650].entries()) {
      const frame = frames.shift();
      act(() => frame(timestamp));
      expect(hook.result.current).toEqual(expected[index]);
    }
    expect(hook.result.current.sungMidi).toBeNull();
    expect(hook.result.current.isPitchDetected).toBe(false);
    expect(hook.result.current.isPitchAttacking).toBe(false);
    expect(hook.result.current.pitchRestProgress).toBe(1);
    expect(audio.source.connect).toHaveBeenCalledWith(audio.analyser);
    hook.unmount();
    expect(audio.source.disconnect).toHaveBeenCalled();
  });

  test("resets a previously detected pitch when playback stops", async () => {
    const audio = createAudio();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() }
    });
    mocks.detectMidiFromAnalyser.mockReturnValue(69);
    const input = props({
      browserMonitorRef: { current: { stream: audio.stream, context: audio.context } }
    });
    const hook = renderHook((value) => usePitchDetection(value), { initialProps: input });
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    act(() => frames.shift()(40));
    expect(hook.result.current.isPitchDetected).toBe(true);
    hook.rerender({ ...input, isPlaying: false });
    expect(hook.result.current).toEqual({
      sungMidi: null,
      isPitchDetected: false,
      isPitchAttacking: false,
      pitchRestProgress: 1
    });
  });

  test("resets immediately when an active detector is restarted", async () => {
    const audio = createAudio();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() }
    });
    mocks.detectMidiFromAnalyser.mockReturnValue(69);
    const input = props({
      browserMonitorRef: { current: { stream: audio.stream, context: audio.context } }
    });
    const hook = renderHook((value) => usePitchDetection(value), { initialProps: input });
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    act(() => frames.shift()(40));
    expect(hook.result.current.isPitchDetected).toBe(true);
    hook.rerender({ ...input, monitorInputDeviceId: "other" });
    expect(hook.result.current).toEqual({
      sungMidi: null,
      isPitchDetected: false,
      isPitchAttacking: false,
      pitchRestProgress: 1
    });
  });

  test("requests a preferred microphone, falls back and owns its audio graph", async () => {
    const audio = createAudio({ state: "suspended" });
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new Error("preferred unavailable"))
      .mockResolvedValueOnce(audio.stream);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    installAudioContext(audio);
    const hook = renderHook(() => usePitchDetection(props({ monitorInputDeviceId: "usb-mic" }))
    );
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[0][0].audio.deviceId).toEqual({ exact: "usb-mic" });
    expect(getUserMedia.mock.calls[0][0].audio).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      deviceId: { exact: "usb-mic" }
    });
    expect(getUserMedia.mock.calls[1][0]).toEqual({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
    expect(audio.context.options).toEqual({ latencyHint: "interactive" });
    expect(audio.context.resume).toHaveBeenCalled();
    hook.unmount();
    expect(audio.track.stop).toHaveBeenCalled();
    expect(audio.context.close).toHaveBeenCalled();
    audio.context.close.mockClear();
  });

  test("reuses a stream when at least one audio track is live", async () => {
    const audio = createAudio();
    const endedTrack = { readyState: "ended", stop: vi.fn() };
    audio.stream.getAudioTracks = () => [endedTrack, audio.track];
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    const hook = renderHook(() =>
      usePitchDetection(
        props({ browserMonitorRef: { current: { stream: audio.stream, context: audio.context } } })
      )
    );
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(audio.context.resume).not.toHaveBeenCalled();
    hook.unmount();
    expect(audio.track.stop).not.toHaveBeenCalled();
    expect(endedTrack.stop).not.toHaveBeenCalled();
    expect(audio.context.close).not.toHaveBeenCalled();
  });

  test("captures a new stream when all borrowed tracks are ended", async () => {
    const borrowed = createAudio();
    borrowed.track.readyState = "ended";
    const captured = createAudio();
    const getUserMedia = vi.fn().mockResolvedValue(captured.stream);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    const hook = renderHook(() =>
      usePitchDetection(
        props({
          browserMonitorRef: { current: { stream: borrowed.stream, context: borrowed.context } }
        })
      )
    );
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    expect(getUserMedia).toHaveBeenCalledOnce();
    hook.unmount();
    expect(captured.track.stop).toHaveBeenCalled();
    expect(borrowed.track.stop).not.toHaveBeenCalled();
  });

  test("captures when a borrowed stream has no audio-track accessor", async () => {
    const captured = createAudio();
    const getUserMedia = vi.fn().mockResolvedValue(captured.stream);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    const hook = renderHook(() =>
      usePitchDetection(
        props({ browserMonitorRef: { current: { stream: {}, context: captured.context } } })
      )
    );
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    expect(getUserMedia).toHaveBeenCalledOnce();
    hook.unmount();
  });

  test("replaces a closed context and never resumes a running replacement", async () => {
    const closed = createAudio({ state: "closed" });
    const replacement = createAudio();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() }
    });
    installAudioContext(replacement);
    const hook = renderHook(() =>
      usePitchDetection(
        props({ browserMonitorRef: { current: { stream: closed.stream, context: closed.context } } })
      )
    );
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    expect(window.AudioContext).toHaveBeenCalledOnce();
    expect(replacement.context.resume).not.toHaveBeenCalled();
    hook.unmount();
  });

  test("does not construct a context when every capture attempt fails", async () => {
    const audio = createAudio();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error("denied")) }
    });
    installAudioContext(audio);
    const hook = renderHook(() => usePitchDetection(props()));
    await act(async () => Promise.resolve());
    expect(window.AudioContext).not.toHaveBeenCalled();
    expect(frames).toEqual([]);
    hook.unmount();
  });

  test("falls back from a null preferred capture to the generic microphone", async () => {
    const audio = createAudio();
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(audio.stream);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    installAudioContext(audio);
    const hook = renderHook(() => usePitchDetection(props({ monitorInputDeviceId: "preferred" }))
    );
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  test.each(["default", ""])(
    "uses one generic capture candidate for device %j",
    async (monitorInputDeviceId) => {
      const audio = createAudio();
      const getUserMedia = vi.fn().mockResolvedValue(audio.stream);
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia }
      });
      installAudioContext(audio);
      const hook = renderHook(() => usePitchDetection(props({ monitorInputDeviceId }))
      );
      await waitFor(() => expect(frames.length).toBeGreaterThan(0));
      expect(getUserMedia).toHaveBeenCalledOnce();
      expect(getUserMedia).toHaveBeenCalledWith({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      hook.unmount();
    }
  );

  test("resets safely after capture or Web Audio failures", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error("permission denied")) }
    });
    const capture = renderHook(() => usePitchDetection(props()));
    await act(async () => Promise.resolve());
    expect(capture.result.current.sungMidi).toBeNull();
    capture.unmount();

    const audio = createAudio({ state: "suspended" });
    audio.context.resume.mockRejectedValue(new Error("resume denied"));
    const resume = renderHook(() =>
      usePitchDetection(
        props({ browserMonitorRef: { current: { stream: audio.stream, context: audio.context } } })
      )
    );
    await act(async () => Promise.resolve());
    expect(resume.result.current.isPitchDetected).toBe(false);
  });

  test("releases resources when capture resolves after unmount", async () => {
    const audio = createAudio();
    audio.context.close.mockRejectedValue(new Error("already closed"));
    let resolveStream;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn( () => new Promise((resolve) => { resolveStream = resolve; }) ) }
    });
    installAudioContext(audio);
    const hook = renderHook(() => usePitchDetection(props()));
    await waitFor(() => expect(resolveStream).toBeTypeOf("function"));
    hook.unmount();
    await act(async () => resolveStream(audio.stream));
    expect(audio.track.stop).toHaveBeenCalled();
    expect(audio.context.close).toHaveBeenCalled();
    audio.context.close.mockClear();

    let resolveBorrowedContextStream;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(
          () =>
            new Promise((resolve) => { resolveBorrowedContextStream = resolve; })
        )
      }
    });
    const borrowed = renderHook(() =>
      usePitchDetection( props({ browserMonitorRef: { current: { context: audio.context } } })
      )
    );
    await waitFor(() => expect(resolveBorrowedContextStream).toBeTypeOf("function")
    );
    borrowed.unmount();
    await act(async () => resolveBorrowedContextStream(audio.stream));
    expect(audio.context.close).not.toHaveBeenCalled();
  });

  test("handles null and stale capture results after unmount", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(null) }
    });
    const empty = renderHook(() => usePitchDetection(props()));
    await act(async () => Promise.resolve());
    expect(empty.result.current.sungMidi).toBeNull();
    empty.unmount();

    let rejectCapture;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn( () => new Promise((_resolve, reject) => { rejectCapture = reject; })
        )
      }
    });
    const stale = renderHook(() => usePitchDetection(props()));
    await waitFor(() => expect(rejectCapture).toBeTypeOf("function"));
    stale.unmount();
    await act(async () => rejectCapture(new Error("late")));
  });

  test("throttles pitch measurement and render frames", async () => {
    const audio = createAudio();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() }
    });
    mocks.detectMidiFromAnalyser
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(69)
      .mockReturnValue(null);
    const input = props({
      browserMonitorRef: { current: { stream: audio.stream, context: audio.context } }
    });
    const hook = renderHook(() => usePitchDetection(input));
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    for (const timestamp of [40, 45, 80, 85, 200, 210]) {
      const frame = frames.shift();
      act(() => frame(timestamp));
    }
    hook.unmount();
  });

  test("honors exact measurement, animation, attack and rest boundaries", async () => {
    const audio = createAudio();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() }
    });
    mocks.detectMidiFromAnalyser
      .mockReturnValueOnce(60)
      .mockReturnValueOnce(90)
      .mockReturnValue(null);
    const input = props({
      browserMonitorRef: { current: { stream: audio.stream, context: audio.context } }
    });
    const hook = renderHook(() => usePitchDetection(input));
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));

    act(() => frames.shift()(34));
    expect(mocks.detectMidiFromAnalyser).not.toHaveBeenCalled();
    act(() => frames.shift()(35));
    expect(mocks.detectMidiFromAnalyser).toHaveBeenCalledOnce();
    act(() => frames.shift()(69));
    expect(mocks.detectMidiFromAnalyser).toHaveBeenCalledOnce();
    act(() => frames.shift()(70));
    expect(mocks.detectMidiFromAnalyser).toHaveBeenCalledTimes(2);
    expect(hook.result.current.sungMidi).toBe(60);

    act(() => frames.shift()(75));
    const renderedAt75 = hook.result.current.sungMidi;
    act(() => frames.shift()(80));
    expect(hook.result.current.sungMidi).toBe(renderedAt75);
    act(() => frames.shift()(84));
    expect(hook.result.current.sungMidi).toBeCloseTo(60.33, 6);
    act(() => frames.shift()(90));
    expect(hook.result.current.sungMidi).toBeCloseTo(60.33, 6);

    act(() => frames.shift()(164));
    expect(hook.result.current.isPitchAttacking).toBe(true);
    act(() => frames.shift()(165));
    expect(hook.result.current.isPitchAttacking).toBe(false);
    act(() => frames.shift()(180));
    expect(hook.result.current.isPitchDetected).toBe(true);
    act(() => frames.shift()(181));
    expect(hook.result.current.isPitchDetected).toBe(false);
    expect(hook.result.current.pitchRestProgress).toBe(0);
    act(() => frames.shift()(211));
    expect(hook.result.current.pitchRestProgress).toBe(0);
    act(() => frames.shift()(212));
    expect(hook.result.current.pitchRestProgress).toBeCloseTo(31 / 380, 6);
    hook.unmount();
  });

  test("starts a fresh attack when voice returns during the rest fade", async () => {
    const audio = createAudio();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() }
    });
    mocks.detectMidiFromAnalyser.mockReturnValue(60);
    const input = props({
      browserMonitorRef: { current: { stream: audio.stream, context: audio.context } }
    });
    const hook = renderHook(() => usePitchDetection(input));
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    act(() => frames.shift()(40));
    expect(mocks.detectMidiFromAnalyser).toHaveBeenCalledOnce();
    expect(mocks.detectMidiFromAnalyser.mock.results[0].value).toBe(60);
    expect(hook.result.current).toEqual({
      sungMidi: 60,
      isPitchDetected: true,
      isPitchAttacking: true,
      pitchRestProgress: 0
    });
    mocks.detectMidiFromAnalyser.mockReturnValue(null);
    act(() => frames.shift()(151));
    expect(hook.result.current.isPitchDetected).toBe(false);
    expect(hook.result.current.isPitchAttacking).toBe(false);
    mocks.detectMidiFromAnalyser.mockReturnValue(65);
    act(() => frames.shift()(190));
    expect(hook.result.current).toEqual({
      sungMidi: 65,
      isPitchDetected: true,
      isPitchAttacking: true,
      pitchRestProgress: 0
    });
    hook.unmount();
  });

  test("ignores a rejected owned-context close during normal cleanup", async () => {
    const audio = createAudio();
    audio.context.close.mockRejectedValue(new Error("already closed"));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(audio.stream) }
    });
    installAudioContext(audio);
    const hook = renderHook(() => usePitchDetection(props()));
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    hook.unmount();
    await act(async () => Promise.resolve());
    expect(audio.context.close).toHaveBeenCalled();
  });

  test("handles missing Web Audio and a cancelled suspended context", async () => {
    const audio = createAudio({ state: "suspended" });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(audio.stream) }
    });
    const unavailable = renderHook(() => usePitchDetection(props()));
    await act(async () => Promise.resolve());
    expect(unavailable.result.current.sungMidi).toBeNull();
    unavailable.unmount();

    let resolveResume;
    audio.context.resume.mockReturnValue( new Promise((resolve) => { resolveResume = resolve; })
    );
    installAudioContext(audio);
    const cancelled = renderHook(() => usePitchDetection(props()));
    await waitFor(() => expect(resolveResume).toBeTypeOf("function"));
    cancelled.unmount();
    await act(async () => resolveResume());
    expect(frames).toEqual([]);
  });

  test("drops stale frames and keeps only the latest pitch samples", async () => {
    const audio = createAudio();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn() }
    });
    mocks.detectMidiFromAnalyser
      .mockReturnValueOnce(64)
      .mockReturnValueOnce(60)
      .mockReturnValueOnce(62)
      .mockReturnValueOnce(61)
      .mockReturnValueOnce(63);
    const input = props({
      browserMonitorRef: { current: { stream: audio.stream, context: audio.context } }
    });
    const hook = renderHook(() => usePitchDetection(input));
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    for (const timestamp of [40, 80, 120, 160, 200]) {
      const frame = frames.shift();
      act(() => frame(timestamp));
    }
    expect(hook.result.current.sungMidi).toBeCloseTo(62.146624, 6);
    const stale = frames.shift();
    const scheduledFrames = requestAnimationFrame.mock.calls.length;
    hook.unmount();
    act(() => stale(200));
    expect(mocks.detectMidiFromAnalyser).toHaveBeenCalledTimes(5);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(scheduledFrames);
  });
});
