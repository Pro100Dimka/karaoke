/* @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({
  startRecording: vi.fn(),
  pauseRecording: vi.fn(),
  resumeRecording: vi.fn(),
  stopRecording: vi.fn()
}));
vi.mock("../src/api/client", () => ({ api }));

import useKaraokeTransport from "../src/pages/Karaoke/hooks/useKaraokeTransport.js";

const media = () => ({
  currentTime: 4,
  duration: 100,
  volume: 0,
  play: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn()
});

const createProps = (overrides = {}) => {
  const instrumental = media();
  const vocals = media();
  const video = media();
  return {
    song: { id: "song" },
    onlineRoom: {
      room: { id: "room" },
      syncCommand: vi.fn(),
      roomCommand: null
    },
    navigate: vi.fn(),
    instrumentalRef: { current: instrumental },
    vocalsRef: { current: vocals },
    videoRef: { current: video },
    durationRef: { current: 100 },
    currentTime: 4,
    duration: 100,
    isPlaying: false,
    recordingSessionId: null,
    musicVolume: 0.8,
    vocalVolume: 0.7,
    microphoneVolume: 0.6,
    microphoneEffects: { reverb: 0.1, echo: 0.2, delay: 0.3 },
    startMelodyGuide: vi.fn().mockResolvedValue(true),
    silenceMelodyGuide: vi.fn(),
    sendYouTubeCommand: vi.fn(),
    syncSecondaryMedia: vi.fn(),
    setCurrentTime: vi.fn(),
    setIsPlaying: vi.fn(),
    setRecordingError: vi.fn(),
    setRecordingSessionId: vi.fn(),
    setAnalysisRecordingId: vi.fn(),
    ...overrides
  };
};

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  api.startRecording.mockResolvedValue({ recording_session_id: "session" });
  api.pauseRecording.mockResolvedValue({});
  api.resumeRecording.mockResolvedValue({});
  api.stopRecording.mockResolvedValue({ id: "recording" });
});
afterEach(cleanup);

describe("karaoke transport", () => {
  test("prepares a paused recording session before playback", async () => {
    const props = createProps();
    const { result } = renderHook(() => useKaraokeTransport(props));
    await expect(result.current.preparePlayback()).resolves.toBe(true);
    expect(api.startRecording).toHaveBeenCalledWith(
      "song",
      4,
      expect.any(Number),
      0.6,
      0.1,
      0.2,
      0.3
    );
    expect(api.pauseRecording).toHaveBeenCalledWith("session");
    expect(props.setRecordingSessionId).toHaveBeenCalledWith("session");
    expect(props.setRecordingError).toHaveBeenCalledWith(null);
    await expect(result.current.preparePlayback()).resolves.toBe(true);
    expect(api.startRecording).toHaveBeenCalledOnce();
  });

  test("reports invalid and failed recording preparation", async () => {
    const props = createProps();
    api.startRecording.mockResolvedValueOnce({});
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(hook.result.current.preparePlayback()).resolves.toBe(false);
    expect(props.setRecordingError).toHaveBeenCalled();

    api.startRecording.mockResolvedValueOnce({ recording_session_id: "bad" });
    api.pauseRecording.mockRejectedValueOnce(new Error("pause failed"));
    await expect(hook.result.current.preparePlayback()).resolves.toBe(false);
    expect(api.stopRecording).toHaveBeenCalledWith("bad");
  });

  test("starts all media and a new recording together", async () => {
    const props = createProps();
    const { result } = renderHook(() => useKaraokeTransport(props));
    await expect(result.current.togglePlay()).resolves.toBe(true);
    expect(props.instrumentalRef.current.play).toHaveBeenCalledOnce();
    expect(props.vocalsRef.current.play).toHaveBeenCalledOnce();
    expect(props.videoRef.current.play).toHaveBeenCalledOnce();
    expect(props.startMelodyGuide).toHaveBeenCalledOnce();
    expect(props.syncSecondaryMedia).toHaveBeenCalledTimes(2);
    expect(props.setIsPlaying).toHaveBeenCalledWith(true);
    expect(props.onlineRoom.syncCommand).toHaveBeenCalledWith(
      expect.objectContaining({ action: "play", songId: "song" })
    );
  });

  test("pauses media and an active recording", async () => {
    const props = createProps({
      isPlaying: true,
      recordingSessionId: "existing"
    });
    const { result } = renderHook(() => useKaraokeTransport(props));
    await expect(result.current.togglePlay()).resolves.toBe(true);
    expect(props.instrumentalRef.current.pause).toHaveBeenCalled();
    expect(props.vocalsRef.current.pause).toHaveBeenCalled();
    expect(props.videoRef.current.pause).toHaveBeenCalled();
    expect(props.sendYouTubeCommand).toHaveBeenCalledWith("pauseVideo");
    expect(api.pauseRecording).toHaveBeenCalledWith("existing");
    expect(props.onlineRoom.syncCommand).toHaveBeenCalledWith(
      expect.objectContaining({ action: "pause" })
    );
  });

  test("continues karaoke when recording start or resume fails", async () => {
    const startProps = createProps();
    api.startRecording.mockRejectedValueOnce(new Error("microphone missing"));
    const start = renderHook(() => useKaraokeTransport(startProps));
    await expect(start.result.current.togglePlay()).resolves.toBe(true);
    expect(startProps.instrumentalRef.current.play).toHaveBeenCalled();
    expect(startProps.setRecordingError).toHaveBeenCalledWith(
      expect.stringContaining("microphone missing")
    );
    start.unmount();

    const resumeProps = createProps({ recordingSessionId: "existing" });
    api.resumeRecording.mockRejectedValueOnce(new Error("resume failed"));
    const resume = renderHook(() => useKaraokeTransport(resumeProps));
    await expect(
      resume.result.current.togglePlay({ forcePlaying: true })
    ).resolves.toBe(true);
    expect(api.stopRecording).toHaveBeenCalledWith("existing");
    expect(resumeProps.setRecordingSessionId).toHaveBeenCalledWith(null);
  });

  test("rolls playback back when the master media cannot start", async () => {
    const props = createProps();
    props.instrumentalRef.current.play.mockRejectedValue(new Error("codec"));
    const { result } = renderHook(() => useKaraokeTransport(props));
    await expect(result.current.togglePlay()).resolves.toBe(false);
    expect(props.instrumentalRef.current.pause).toHaveBeenCalled();
    expect(api.pauseRecording).toHaveBeenCalledWith("session");
    expect(props.setRecordingError).toHaveBeenCalled();
  });

  test("seeks, skips, stops and returns to the library", async () => {
    const props = createProps({ recordingSessionId: "existing" });
    const { result } = renderHook(() => useKaraokeTransport(props));
    act(() => result.current.seekTo(500));
    expect(props.instrumentalRef.current.currentTime).toBe(100);
    expect(props.setCurrentTime).toHaveBeenCalledWith(100);
    act(() => result.current.skip(-10));
    expect(props.instrumentalRef.current.currentTime).toBe(0);

    await expect(result.current.stop()).resolves.toBe(true);
    expect(api.stopRecording).toHaveBeenCalledWith("existing");
    expect(props.setAnalysisRecordingId).toHaveBeenCalledWith("recording");
    expect(props.setRecordingSessionId).toHaveBeenCalledWith(null);

    await result.current.returnToLibrary();
    expect(props.onlineRoom.syncCommand).toHaveBeenCalledWith({
      type: "open-library"
    });
    expect(props.navigate).toHaveBeenCalledWith("/");
  });

  test("falls back to pausing when saving a recording fails", async () => {
    const props = createProps({ recordingSessionId: "existing" });
    api.stopRecording.mockRejectedValueOnce(new Error("disk full"));
    const { result } = renderHook(() => useKaraokeTransport(props));
    await expect(result.current.stop()).resolves.toBe(true);
    expect(api.pauseRecording).toHaveBeenCalledWith("existing");
    expect(props.setRecordingError).toHaveBeenCalledWith(
      expect.stringContaining("disk full")
    );
  });

  test("applies synchronized room player commands", async () => {
    const props = createProps();
    const hook = renderHook((value) => useKaraokeTransport(value), {
      initialProps: props
    });
    hook.rerender({
      ...props,
      onlineRoom: {
        ...props.onlineRoom,
        roomCommand: {
          type: "karaoke-player",
          songId: "song",
          action: "seek",
          position: 12
        }
      }
    });
    expect(props.setCurrentTime).toHaveBeenCalledWith(12);
    hook.rerender({
      ...props,
      onlineRoom: {
        ...props.onlineRoom,
        roomCommand: {
          type: "karaoke-player",
          songId: "song",
          action: "play",
          position: 12
        }
      }
    });
    await waitFor(() => expect(props.setIsPlaying).toHaveBeenCalledWith(true));
  });

  test("finishes an active session when the song changes or unmounts", async () => {
    const props = createProps({ recordingSessionId: "existing" });
    const hook = renderHook((value) => useKaraokeTransport(value), {
      initialProps: props
    });
    hook.rerender({ ...props, song: { id: "next" } });
    await act(async () => Promise.resolve());
    expect(api.stopRecording).toHaveBeenCalledWith("existing");
    hook.unmount();
  });
});
