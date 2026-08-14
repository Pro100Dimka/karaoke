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

let useKaraokeTransport;

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

beforeEach(async () => {
  vi.resetModules();
  ({ default: useKaraokeTransport } =
    await import("../src/pages/Karaoke/hooks/useKaraokeTransport"));
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
      expect.closeTo(0.64, 10),
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

  test("does not prepare recording without a playable master or when already prepared", async () => {
    for (const props of [
      createProps({ song: null }),
      createProps({ instrumentalRef: { current: null } }),
      createProps({ recordingSessionId: "prepared" })
    ]) {
      // Each iteration owns an independent immutable hook input.
      // eslint-disable-next-line no-loop-func
      const hook = renderHook(() => useKaraokeTransport(props));
      await expect(hook.result.current.preparePlayback()).resolves.toBe(true);
      hook.unmount();
    }
    expect(api.startRecording).not.toHaveBeenCalled();
  });

  test("does not clean up a nonexistent recording session", async () => {
    const hook = renderHook(() => useKaraokeTransport(createProps()));
    hook.unmount();
    await act(async () => Promise.resolve());
    expect(api.stopRecording).not.toHaveBeenCalled();
    expect(api.pauseRecording).not.toHaveBeenCalled();
  });

  test("reports invalid and failed recording preparation", async () => {
    const props = createProps();
    api.startRecording.mockResolvedValueOnce({});
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(hook.result.current.preparePlayback()).resolves.toBe(false);
    expect(props.setRecordingError).toHaveBeenLastCalledWith(
      "Неможливо підготувати запис: Backend не повернув ідентифікатор запису"
    );

    api.startRecording.mockResolvedValueOnce({ recording_session_id: "bad" });
    api.pauseRecording.mockRejectedValueOnce(new Error("pause failed"));
    await expect(hook.result.current.preparePlayback()).resolves.toBe(false);
    expect(api.stopRecording).toHaveBeenCalledWith("bad");
  });

  test("uses the localized unknown-error fallback during preparation", async () => {
    api.startRecording.mockRejectedValueOnce({});
    const props = createProps();
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(hook.result.current.preparePlayback()).resolves.toBe(false);
    expect(props.setRecordingError).toHaveBeenLastCalledWith(
      "Неможливо підготувати запис: невідома помилка"
    );
  });

  test("starts all media and a new recording together", async () => {
    const props = createProps();
    const { result } = renderHook(() => useKaraokeTransport(props));
    await expect(result.current.togglePlay()).resolves.toBe(true);
    expect(props.instrumentalRef.current.play).toHaveBeenCalledOnce();
    expect(props.vocalsRef.current.play).toHaveBeenCalledOnce();
    expect(props.videoRef.current.play).toHaveBeenCalledOnce();
    expect(props.startMelodyGuide).toHaveBeenCalledOnce();
    expect(props.syncSecondaryMedia).toHaveBeenNthCalledWith(1, 4, true);
    expect(props.syncSecondaryMedia).toHaveBeenNthCalledWith(2, 4, true);
    expect(props.instrumentalRef.current.volume).toBeCloseTo(0.64);
    expect(props.vocalsRef.current.volume).toBeCloseTo(0.49);
    expect(props.sendYouTubeCommand).toHaveBeenCalledWith("playVideo");
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
    expect(props.onlineRoom.syncCommand).toHaveBeenCalledWith({
      type: "karaoke-player",
      action: "pause",
      songId: "song",
      position: 4
    });
  });

  test("pauses without touching the recording API when no session exists", async () => {
    const props = createProps({ isPlaying: true });
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(hook.result.current.togglePlay()).resolves.toBe(true);
    expect(api.pauseRecording).not.toHaveBeenCalled();
    expect(props.setIsPlaying).toHaveBeenCalledWith(false);
  });

  test("obeys explicit local-only playback commands", async () => {
    const props = createProps({ isPlaying: true });
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(
      hook.result.current.togglePlay({ broadcast: false, forcePlaying: false })
    ).resolves.toBe(true);
    expect(props.setIsPlaying).toHaveBeenCalledWith(false);
    expect(props.onlineRoom.syncCommand).not.toHaveBeenCalled();

    props.setIsPlaying.mockClear();
    await expect(
      hook.result.current.togglePlay({ broadcast: false, forcePlaying: true })
    ).resolves.toBe(true);
    expect(props.setIsPlaying).toHaveBeenCalledWith(true);
    expect(props.onlineRoom.syncCommand).not.toHaveBeenCalled();
  });

  test("resumes a prepared recording without starting a replacement", async () => {
    const props = createProps({ recordingSessionId: "prepared" });
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(
      hook.result.current.togglePlay({ forcePlaying: true })
    ).resolves.toBe(true);
    expect(api.resumeRecording).toHaveBeenCalledWith("prepared");
    expect(api.startRecording).not.toHaveBeenCalled();
    expect(props.setRecordingError).toHaveBeenCalledWith(null);
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
    expect(resumeProps.setRecordingError).toHaveBeenCalledWith(
      "Не вдалося відновити запис, караоке продовжить роботу без нього: resume failed"
    );
  });

  test("handles a null recording response as a non-fatal recording failure", async () => {
    api.startRecording.mockResolvedValueOnce(null);
    const props = createProps();
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(
      hook.result.current.togglePlay({ forcePlaying: true })
    ).resolves.toBe(true);
    expect(props.setRecordingError).toHaveBeenCalledWith(
      "Запис недоступний, караоке продовжить роботу без нього: Backend не повернув ідентифікатор запису"
    );
  });

  test("handles a null recording response during preparation", async () => {
    api.startRecording.mockResolvedValueOnce(null);
    const props = createProps();
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(hook.result.current.preparePlayback()).resolves.toBe(false);
    expect(props.setRecordingError).toHaveBeenCalledWith(
      "Неможливо підготувати запис: Backend не повернув ідентифікатор запису"
    );
  });

  test("rolls playback back when the master media cannot start", async () => {
    const props = createProps();
    props.instrumentalRef.current.play.mockRejectedValue(new Error("codec"));
    const { result } = renderHook(() => useKaraokeTransport(props));
    await expect(result.current.togglePlay()).resolves.toBe(false);
    expect(props.instrumentalRef.current.pause).toHaveBeenCalled();
    expect(api.pauseRecording).toHaveBeenCalledWith("session");
    expect(props.syncSecondaryMedia).toHaveBeenNthCalledWith(1, 4, true);
    expect(props.setIsPlaying).toHaveBeenCalledWith(false);
    expect(props.setRecordingError).toHaveBeenCalledWith(
      "Не вдалося запустити відтворення"
    );
  });

  test("does not pause a missing recording after media startup fails", async () => {
    api.startRecording.mockRejectedValueOnce(new Error("no microphone"));
    const props = createProps();
    props.instrumentalRef.current.play.mockRejectedValue(new Error("codec"));
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(
      hook.result.current.togglePlay({ forcePlaying: true })
    ).resolves.toBe(false);
    expect(api.pauseRecording).not.toHaveBeenCalled();
  });

  test("tolerates the master ref disappearing during asynchronous startup", async () => {
    let rejectPlay;
    const props = createProps();
    props.instrumentalRef.current.play.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectPlay = reject;
      })
    );
    const hook = renderHook(() => useKaraokeTransport(props));
    const playback = hook.result.current.togglePlay({ forcePlaying: true });
    await waitFor(() => expect(rejectPlay).toBeTypeOf("function"));
    props.instrumentalRef.current = null;
    rejectPlay(new Error("detached"));
    await expect(playback).resolves.toBe(false);
  });

  test("ignores failures from optional secondary media and melody startup", async () => {
    const props = createProps({
      startMelodyGuide: vi.fn(() => {
        throw new Error("closed audio context");
      })
    });
    props.vocalsRef.current.play.mockRejectedValue(new Error("vocals"));
    props.videoRef.current.play.mockRejectedValue(new Error("video"));
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(
      hook.result.current.togglePlay({ forcePlaying: true })
    ).resolves.toBe(true);
    expect(props.instrumentalRef.current.play).toHaveBeenCalledOnce();
    expect(props.setIsPlaying).toHaveBeenCalledWith(true);
  });

  test("seeks, skips, stops and returns to the library", async () => {
    const props = createProps({ recordingSessionId: "existing" });
    const { result } = renderHook(() => useKaraokeTransport(props));
    act(() => result.current.seekTo(500));
    expect(props.instrumentalRef.current.currentTime).toBe(100);
    expect(props.setCurrentTime).toHaveBeenCalledWith(100);
    expect(props.onlineRoom.syncCommand).toHaveBeenLastCalledWith({
      type: "karaoke-player",
      action: "seek",
      songId: "song",
      position: 100
    });
    act(() => result.current.skip(-10));
    expect(props.instrumentalRef.current.currentTime).toBe(0);

    await expect(result.current.stop()).resolves.toBe(true);
    expect(props.syncSecondaryMedia).toHaveBeenLastCalledWith(0, true);
    expect(props.setIsPlaying).toHaveBeenLastCalledWith(false);
    expect(api.stopRecording).toHaveBeenCalledWith("existing");
    expect(props.setAnalysisRecordingId).toHaveBeenCalledWith("recording");
    expect(props.setRecordingSessionId).toHaveBeenCalledWith(null);

    props.onlineRoom.syncCommand.mockClear();
    await result.current.returnToLibrary();
    expect(props.onlineRoom.syncCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "stop" })
    );
    expect(props.onlineRoom.syncCommand).toHaveBeenCalledWith({
      type: "open-library"
    });
    expect(props.navigate).toHaveBeenCalledWith("/");
  });

  test("clamps invalid seeks and supports local-only seek and stop", async () => {
    const props = createProps({ recordingSessionId: "existing" });
    const hook = renderHook(() => useKaraokeTransport(props));
    act(() => hook.result.current.seekTo(Number.NaN, { broadcast: false }));
    expect(props.instrumentalRef.current.currentTime).toBe(0);
    expect(props.syncSecondaryMedia).toHaveBeenLastCalledWith(0, true);
    expect(props.onlineRoom.syncCommand).not.toHaveBeenCalled();
    await expect(hook.result.current.stop({ broadcast: false })).resolves.toBe(
      true
    );
    expect(props.onlineRoom.syncCommand).not.toHaveBeenCalled();
  });

  test("default stop broadcasts the exact room command", async () => {
    const props = createProps();
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(hook.result.current.stop()).resolves.toBe(true);
    expect(props.onlineRoom.syncCommand).toHaveBeenCalledWith({
      type: "karaoke-player",
      action: "stop",
      songId: "song",
      position: 0
    });
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

  test("a superseded preparation never clears an externally replaced session", async () => {
    let release;
    api.startRecording.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    const props = createProps();
    const hook = renderHook((value) => useKaraokeTransport(value), {
      initialProps: props
    });
    const preparation = hook.result.current.preparePlayback();
    hook.rerender({
      ...props,
      song: { id: "next" },
      recordingSessionId: "replacement"
    });
    props.setRecordingSessionId.mockClear();
    release({ recording_session_id: "old-preparation" });
    await expect(preparation).resolves.toBe(false);
    expect(api.stopRecording).toHaveBeenCalledWith("old-preparation");
    expect(props.setRecordingSessionId).not.toHaveBeenCalledWith(null);
  });

  test("song cleanup finishes the previous session, never its replacement", async () => {
    const initial = createProps({ recordingSessionId: "old-session" });
    const hook = renderHook((value) => useKaraokeTransport(value), {
      initialProps: initial
    });
    hook.rerender({
      ...initial,
      song: { id: "next" },
      recordingSessionId: "new-session"
    });
    await act(async () => Promise.resolve());
    expect(api.stopRecording).toHaveBeenCalledWith("old-session");
    expect(api.stopRecording).not.toHaveBeenCalledWith("new-session");
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
    expect(api.stopRecording).not.toHaveBeenCalledWith("late-pause");
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
    expect(api.stopRecording).toHaveBeenCalledWith("late-stop");
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
      expect(throwingProps.setIsPlaying).toHaveBeenCalledWith(true)
    );
  });

  test("ignores unrelated, malformed and unknown room commands", async () => {
    const props = createProps();
    const hook = renderHook((value) => useKaraokeTransport(value), {
      initialProps: props
    });
    const commands = [
      { type: "other", songId: "song", action: "play", position: 5 },
      { type: "karaoke-player", songId: "other", action: "play", position: 5 },
      {
        type: "karaoke-player",
        songId: "song",
        action: "unknown",
        position: "not-finite"
      }
    ];
    for (const roomCommand of commands) {
      hook.rerender({
        ...props,
        onlineRoom: { ...props.onlineRoom, roomCommand }
      });
      await act(async () => Promise.resolve());
    }
    expect(props.instrumentalRef.current.play).not.toHaveBeenCalled();
    expect(props.instrumentalRef.current.pause).not.toHaveBeenCalled();
    expect(props.setCurrentTime).not.toHaveBeenCalled();
    expect(props.onlineRoom.syncCommand).not.toHaveBeenCalled();
  });

  test("room transport never echoes synchronized commands", async () => {
    for (const action of ["play", "pause", "stop"]) {
      const props = createProps({ recordingSessionId: "existing" });
      // Each iteration owns an independent immutable hook input.
      // eslint-disable-next-line no-loop-func
      const hook = renderHook(() =>
        useKaraokeTransport({
          ...props,
          onlineRoom: {
            ...props.onlineRoom,
            roomCommand: {
              type: "karaoke-player",
              songId: "song",
              action,
              position: 7
            }
          }
        })
      );
      await waitFor(() =>
        expect(props.setCurrentTime).toHaveBeenCalledWith(
          action === "stop" ? 0 : 7
        )
      );
      expect(props.onlineRoom.syncCommand).not.toHaveBeenCalled();
      if (action === "pause") {
        expect(props.setIsPlaying).toHaveBeenCalledWith(false);
        expect(props.instrumentalRef.current.play).not.toHaveBeenCalled();
      }
      hook.unmount();
    }
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
    expect(props.setCurrentTime).not.toHaveBeenCalled();
    expect(props.syncSecondaryMedia).not.toHaveBeenCalled();
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
    let releaseStart;
    api.startRecording.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseStart = resolve;
      })
    );
    const props = createProps();
    const hook = renderHook(() => useKaraokeTransport(props));
    const playback = hook.result.current.togglePlay({ forcePlaying: true });
    await waitFor(() => expect(releaseStart).toBeTypeOf("function"));
    await hook.result.current.stop();
    api.stopRecording.mockClear();
    api.pauseRecording.mockClear();
    releaseStart({});
    await expect(playback).resolves.toBe(false);
    expect(props.instrumentalRef.current.play).not.toHaveBeenCalled();
    expect(api.stopRecording).not.toHaveBeenCalled();
    expect(api.pauseRecording).not.toHaveBeenCalled();
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
    props.setRecordingError.mockClear();
    api.stopRecording.mockResolvedValueOnce(null);
    await expect(hook.result.current.stop()).resolves.toBe(true);
    expect(props.setAnalysisRecordingId).not.toHaveBeenCalled();
    expect(props.setRecordingError).not.toHaveBeenCalled();
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

  test("does not publish an analysis id when recording save has no id", async () => {
    api.stopRecording.mockResolvedValueOnce({});
    const props = createProps({ recordingSessionId: "existing" });
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(hook.result.current.stop()).resolves.toBe(true);
    expect(props.setAnalysisRecordingId).not.toHaveBeenCalled();
    expect(props.setRecordingError).not.toHaveBeenCalled();
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
    await shared.result.current.stop({ broadcast: false });
    await shared.result.current.togglePlay({
      broadcast: false,
      forcePlaying: true
    });
    expect(api.startRecording).toHaveBeenCalledTimes(2);
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

  test("an old startup cannot clear a newer pending recording request", async () => {
    let releaseOld;
    let releaseNew;
    api.startRecording
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releaseOld = resolve;
        })
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releaseNew = resolve;
        })
      );
    const initial = createProps();
    const hook = renderHook((value) => useKaraokeTransport(value), {
      initialProps: initial
    });
    const oldPlayback = hook.result.current.togglePlay({ forcePlaying: true });
    hook.rerender({ ...initial, song: { id: "new-song" } });
    const newPlayback = hook.result.current.togglePlay({ forcePlaying: true });
    releaseOld({ recording_session_id: "old" });
    await expect(oldPlayback).resolves.toBe(false);
    const sharedNewPlayback = hook.result.current.togglePlay({
      forcePlaying: true
    });
    expect(api.startRecording).toHaveBeenCalledTimes(2);
    releaseNew({ recording_session_id: "new" });
    await Promise.all([newPlayback, sharedNewPlayback]);
  });

  test("does not clear a replacement session after stale resume failure", async () => {
    let rejectResume;
    api.resumeRecording.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectResume = reject;
      })
    );
    const props = createProps({ recordingSessionId: "existing" });
    const hook = renderHook((value) => useKaraokeTransport(value), {
      initialProps: props
    });
    const playback = hook.result.current.togglePlay({ forcePlaying: true });
    await act(async () => Promise.resolve());
    hook.rerender({ ...props, recordingSessionId: "replacement" });
    props.setRecordingSessionId.mockClear();
    rejectResume(new Error("late resume"));
    await expect(playback).resolves.toBe(true);
    expect(props.setRecordingSessionId).not.toHaveBeenCalledWith(null);
  });

  test("uses the latest externally supplied recording session", async () => {
    const props = createProps();
    const hook = renderHook((value) => useKaraokeTransport(value), {
      initialProps: props
    });
    hook.rerender({
      ...props,
      isPlaying: true,
      recordingSessionId: "external"
    });
    await hook.result.current.togglePlay({ forcePlaying: false });
    expect(api.pauseRecording).toHaveBeenCalledWith("external");
  });

  test("reports room command promise failures", async () => {
    const props = createProps({
      sendYouTubeCommand: vi.fn(() => {
        throw new Error("room transport exploded");
      }),
      recordingSessionId: "existing"
    });
    renderHook(() =>
      useKaraokeTransport({
        ...props,
        onlineRoom: {
          ...props.onlineRoom,
          roomCommand: {
            type: "karaoke-player",
            songId: "song",
            action: "pause",
            position: 2
          }
        }
      })
    );
    await waitFor(() =>
      expect(props.setRecordingError).toHaveBeenCalledWith(
        expect.stringContaining("room transport exploded")
      )
    );
  });

  test("ignores room commands safely when no song is loaded", () => {
    const props = createProps({ song: null });
    expect(() =>
      renderHook(() =>
        useKaraokeTransport({
          ...props,
          onlineRoom: {
            ...props.onlineRoom,
            roomCommand: {
              type: "karaoke-player",
              songId: "song",
              action: "play",
              position: 1
            }
          }
        })
      )
    ).not.toThrow();
  });
});
