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

  test("falls back to pausing when cleanup cannot finish a session", async () => {
    api.stopRecording.mockRejectedValueOnce(new Error("stop failed"));
    api.pauseRecording.mockRejectedValueOnce(new Error("pause failed"));
    const hook = renderHook(() =>
      useKaraokeTransport(
        createProps({ recordingSessionId: "cleanup-session" })
      )
    );
    hook.unmount();
    await act(async () => Promise.resolve());
    expect(api.pauseRecording).toHaveBeenCalledWith("cleanup-session");
  });

  test("settles recording startup superseded by pause and stop operations", async () => {
    let releasePause;
    api.startRecording.mockReturnValueOnce(
      new Promise((resolve) => {
        releasePause = resolve;
      })
    );
    const pauseProps = createProps();
    api.pauseRecording.mockRejectedValueOnce(new Error("late pause failed"));
    const pauseHook = renderHook(() => useKaraokeTransport(pauseProps));
    const starting = pauseHook.result.current.togglePlay({
      forcePlaying: true
    });
    await act(async () => Promise.resolve());
    await pauseHook.result.current.togglePlay({ forcePlaying: false });
    releasePause({ recording_session_id: "late-pause" });
    await expect(starting).resolves.toBe(false);
    expect(api.pauseRecording).toHaveBeenCalledWith("late-pause");
    pauseHook.unmount();

    let releaseStop;
    api.startRecording.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseStop = resolve;
      })
    );
    api.stopRecording.mockRejectedValueOnce(new Error("late stop failed"));
    api.pauseRecording.mockRejectedValueOnce(new Error("late fallback failed"));
    const stopProps = createProps();
    const stopHook = renderHook(() => useKaraokeTransport(stopProps));
    const secondStart = stopHook.result.current.togglePlay({
      forcePlaying: true
    });
    await act(async () => Promise.resolve());
    await stopHook.result.current.stop();
    releaseStop({ recording_session_id: "late-stop" });
    await expect(secondStart).resolves.toBe(false);
    expect(api.pauseRecording).toHaveBeenCalledWith("late-stop");
    expect(stopProps.setRecordingSessionId).toHaveBeenCalledWith(null);
    stopHook.unmount();
  });

  test("applies room pause and stop commands and reports rejected room play", async () => {
    const props = createProps({ recordingSessionId: "existing" });
    const hook = renderHook((value) => useKaraokeTransport(value), {
      initialProps: props
    });
    for (const action of ["pause", "stop"]) {
      hook.rerender({
        ...props,
        onlineRoom: {
          ...props.onlineRoom,
          roomCommand: {
            type: "karaoke-player",
            songId: "song",
            action,
            position: 2
          }
        }
      });
      await act(async () => Promise.resolve());
    }
    expect(props.instrumentalRef.current.pause).toHaveBeenCalled();

    const throwingProps = createProps({
      startMelodyGuide: vi.fn(() => {
        throw new Error("guide failed");
      })
    });
    renderHook(() =>
      useKaraokeTransport({
        ...throwingProps,
        onlineRoom: {
          ...throwingProps.onlineRoom,
          roomCommand: {
            type: "karaoke-player",
            songId: "song",
            action: "play"
          }
        }
      })
    );
    await waitFor(() =>
      expect(throwingProps.setRecordingError).toHaveBeenCalledWith(
        expect.stringContaining("guide failed")
      )
    );
  });

  test("isolates every best-effort recording cleanup failure", async () => {
    const run = async (props, configure, action) => {
      Object.values(api).forEach((mock) => mock.mockReset());
      api.startRecording.mockResolvedValue({ recording_session_id: "session" });
      api.resumeRecording.mockResolvedValue({});
      api.stopRecording.mockResolvedValue({ id: "recording" });
      api.pauseRecording.mockResolvedValue({});
      configure();
      const hook = renderHook(() => useKaraokeTransport(props));
      await action(hook.result.current);
      hook.unmount();
    };

    await run(
      createProps(),
      () => {
        api.pauseRecording.mockRejectedValueOnce(new Error("pause"));
        api.stopRecording.mockRejectedValueOnce(new Error("stop"));
      },
      ({ preparePlayback }) => preparePlayback()
    );
    await run(
      createProps({ isPlaying: true, recordingSessionId: "existing" }),
      () => api.pauseRecording.mockRejectedValueOnce(new Error("pause")),
      ({ togglePlay }) => togglePlay({ forcePlaying: false })
    );
    await run(
      createProps({
        startMelodyGuide: vi.fn().mockRejectedValue(new Error("guide"))
      }),
      () => {},
      ({ togglePlay }) => togglePlay({ forcePlaying: true })
    );
    await run(
      createProps({ recordingSessionId: "existing" }),
      () => {
        api.resumeRecording.mockRejectedValueOnce(new Error("resume"));
        api.stopRecording.mockRejectedValueOnce(new Error("stop"));
      },
      ({ togglePlay }) => togglePlay({ forcePlaying: true })
    );
    const failedMaster = createProps();
    failedMaster.instrumentalRef.current.play.mockRejectedValue(
      new Error("play")
    );
    await run(
      failedMaster,
      () => api.pauseRecording.mockRejectedValueOnce(new Error("pause")),
      ({ togglePlay }) => togglePlay({ forcePlaying: true })
    );
    await run(
      createProps({ recordingSessionId: "existing" }),
      () => {
        api.stopRecording.mockRejectedValueOnce(new Error("stop"));
        api.pauseRecording.mockRejectedValueOnce(new Error("pause"));
      },
      ({ stop }) => stop()
    );
  });

  test("safely ignores transport commands without a playable song", async () => {
    const props = createProps({ song: null, onlineRoom: null });
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(hook.result.current.togglePlay()).resolves.toBeUndefined();
    await expect(hook.result.current.stop()).resolves.toBeUndefined();
    expect(hook.result.current.seekTo(5)).toBeUndefined();
  });

  test("continues playback when recording starts without a session id", async () => {
    api.startRecording.mockResolvedValueOnce({});
    const props = createProps({ onlineRoom: null });
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(
      hook.result.current.togglePlay({ forcePlaying: true })
    ).resolves.toBe(true);
    expect(props.setRecordingError).toHaveBeenCalled();
    expect(props.instrumentalRef.current.play).toHaveBeenCalled();
  });

  test("settles a superseded playback even without a recording session", async () => {
    api.startRecording.mockResolvedValueOnce({});
    let releasePlay;
    const props = createProps();
    props.instrumentalRef.current.play.mockReturnValueOnce(
      new Promise((resolve) => {
        releasePlay = resolve;
      })
    );
    const hook = renderHook(() => useKaraokeTransport(props));
    const playback = hook.result.current.togglePlay({ forcePlaying: true });
    await waitFor(() => expect(releasePlay).toBeTypeOf("function"));
    await hook.result.current.stop();
    releasePlay();
    await expect(playback).resolves.toBe(false);
  });

  test("settles preparation and playback superseded by later operations", async () => {
    let releasePreparation;
    api.startRecording.mockReturnValueOnce(
      new Promise((resolve) => {
        releasePreparation = resolve;
      })
    );
    const prepareProps = createProps();
    const prepareHook = renderHook(() => useKaraokeTransport(prepareProps));
    const preparation = prepareHook.result.current.preparePlayback();
    await prepareHook.result.current.togglePlay({ forcePlaying: false });
    releasePreparation({ recording_session_id: "prepared-late" });
    await expect(preparation).resolves.toBe(false);
    expect(api.pauseRecording).toHaveBeenCalledWith("prepared-late");

    let releasePlay;
    const playbackProps = createProps();
    playbackProps.instrumentalRef.current.play.mockReturnValueOnce(
      new Promise((resolve) => {
        releasePlay = resolve;
      })
    );
    const playbackHook = renderHook(() => useKaraokeTransport(playbackProps));
    const playback = playbackHook.result.current.togglePlay({
      forcePlaying: true
    });
    await waitFor(() => expect(releasePlay).toBeTypeOf("function"));
    await playbackHook.result.current.stop();
    releasePlay();
    await expect(playback).resolves.toBe(false);
    expect(playbackProps.instrumentalRef.current.pause).toHaveBeenCalled();
  });

  test("supports playback without secondary media, recording result or room", async () => {
    const props = createProps({
      onlineRoom: null,
      vocalsRef: { current: null },
      videoRef: { current: null }
    });
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(
      hook.result.current.togglePlay({ forcePlaying: true })
    ).resolves.toBe(true);
    api.stopRecording.mockResolvedValueOnce({});
    await expect(hook.result.current.stop()).resolves.toBe(true);
    await hook.result.current.returnToLibrary();
    expect(props.navigate).toHaveBeenCalledWith("/");

    api.startRecording.mockRejectedValueOnce(new Error("no recording"));
    const failedProps = createProps({
      onlineRoom: null,
      vocalsRef: { current: null },
      videoRef: { current: null }
    });
    failedProps.instrumentalRef.current.play.mockRejectedValueOnce(
      new Error("no media")
    );
    const failed = renderHook(() => useKaraokeTransport(failedProps));
    await expect(
      failed.result.current.togglePlay({ forcePlaying: true })
    ).resolves.toBe(false);
  });

  test("shares pending recording startup and preserves a newer song request", async () => {
    let releaseShared;
    api.startRecording.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseShared = resolve;
      })
    );
    const props = createProps();
    const shared = renderHook(() => useKaraokeTransport(props));
    const first = shared.result.current.togglePlay({ forcePlaying: true });
    const second = shared.result.current.togglePlay({ forcePlaying: true });
    releaseShared({ recording_session_id: "shared" });
    await Promise.all([first, second]);
    shared.unmount();

    let releaseOld;
    api.startRecording.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseOld = resolve;
      })
    );
    const changing = renderHook((value) => useKaraokeTransport(value), {
      initialProps: createProps()
    });
    const oldPlayback = changing.result.current.togglePlay({
      forcePlaying: true
    });
    changing.rerender({ ...createProps(), song: { id: "new-song" } });
    releaseOld({ recording_session_id: "old" });
    await expect(oldPlayback).resolves.toBe(false);
  });

  test("does not clear a replacement session after stale resume failure", async () => {
    let rejectResume;
    api.resumeRecording.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectResume = reject;
      })
    );
    const props = createProps({ recordingSessionId: "existing" });
    const hook = renderHook(() => useKaraokeTransport(props));
    const playback = hook.result.current.togglePlay({ forcePlaying: true });
    await act(async () => Promise.resolve());
    await hook.result.current.stop();
    rejectResume(new Error("late resume"));
    await expect(playback).resolves.toBe(false);
  });
});
