/* @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { called, notCalled, calledWith, verify } from "./helpers/assertions.mjs";
const api = vi.hoisted(() => ({
  startRecording: vi.fn(),
  pauseRecording: vi.fn(),
  resumeRecording: vi.fn(),
  syncRecording: vi.fn(),
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
    onlineRoom: { room: { id: "room" }, syncCommand: vi.fn(), roomCommand: null },
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
    releaseMonitoring: vi.fn().mockResolvedValue(null),
    setRecordingError: vi.fn(),
    setRecordingSessionId: vi.fn(),
    setAnalysisRecordingId: vi.fn(),
    ...overrides
  };
};
beforeEach(async () => {
  vi.resetModules();
  ({ default: useKaraokeTransport } = await import("../src/pages/Karaoke/hooks/useKaraokeTransport"));
  localStorage.clear();
  Object.values(api).forEach((mock) => mock.mockReset());
  api.startRecording.mockResolvedValue({ recording_session_id: "session" });
  api.pauseRecording.mockResolvedValue({});
  api.resumeRecording.mockResolvedValue({});
  api.syncRecording.mockResolvedValue({ status: "synchronized" });
  api.stopRecording.mockResolvedValue({ id: "recording" });
});
describe("karaoke transport", () => {
  test("does not clean up a nonexistent recording session", async () => {
    const hook = renderHook(() => useKaraokeTransport(createProps()));
    hook.unmount();
    await act(async () => Promise.resolve());
    notCalled(api.stopRecording, api.pauseRecording);
  });
  test("starts all media and a new recording together", async () => {
    const props = createProps();
    const { result } = renderHook(() => useKaraokeTransport(props));
    await expect(result.current.togglePlay()).resolves.toBe(true);
    expect(props.instrumentalRef.current.play).toHaveBeenCalledOnce();
    expect(props.vocalsRef.current.play).toHaveBeenCalledOnce();
    expect(props.videoRef.current.play).toHaveBeenCalledOnce();
    expect(props.startMelodyGuide).toHaveBeenCalledOnce();
    expect(api.syncRecording).toHaveBeenCalledWith("session", 4);
    expect(props.syncSecondaryMedia).toHaveBeenNthCalledWith(1, 4, true);
    expect(props.syncSecondaryMedia).toHaveBeenNthCalledWith(2, 4, true);
    verify([props.instrumentalRef.current.volume, "toBeCloseTo", 0.64], [props.vocalsRef.current.volume, "toBeCloseTo", 0.49]);
    calledWith([props.sendYouTubeCommand, ["playVideo"]], [props.setIsPlaying, [true]]);
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem("karaoke-pending-recording-session"))).toEqual({
        id: "session"
      })
    );
    verify([props.onlineRoom.syncCommand, "toHaveBeenCalledWith", expect.objectContaining({ action: "play", songId: "song" })]);
  });
  test("schedules room playback against the shared server clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    try {
      const props = createProps({
        onlineRoom: {
          room: { id: "room" },
          roomClockNow: () => Date.now(),
          syncCommand: vi.fn(),
          roomCommand: null
        }
      });
      const hook = renderHook(() => useKaraokeTransport(props));
      const playback = hook.result.current.togglePlay();
      expect(props.onlineRoom.syncCommand).toHaveBeenCalledWith(expect.objectContaining({ action: "play", executeAt: 1_450 }));
      expect(props.instrumentalRef.current.play).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTimeAsync(450));
      await expect(playback).resolves.toBe(true);
      expect(props.instrumentalRef.current.play).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
  test("pauses media and an active recording", async () => {
    const props = createProps({ isPlaying: true, recordingSessionId: "existing" });
    const { result } = renderHook(() => useKaraokeTransport(props));
    await expect(result.current.togglePlay()).resolves.toBe(true);
    called(props.instrumentalRef.current.pause, props.vocalsRef.current.pause, props.videoRef.current.pause);
    calledWith([props.sendYouTubeCommand, ["pauseVideo"]], [api.pauseRecording, ["existing"]]);
    verify([
      props.onlineRoom.syncCommand,
      "toHaveBeenCalledWith",
      expect.objectContaining({ type: "karaoke-player", action: "pause", songId: "song", position: 4 })
    ]);
  });
  test("pauses without touching the recording API when no session exists", async () => {
    const props = createProps({ isPlaying: true });
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(hook.result.current.togglePlay()).resolves.toBe(true);
    verify([api.pauseRecording, "not.toHaveBeenCalled"], [props.setIsPlaying, "toHaveBeenCalledWith", false]);
  });
  test("obeys explicit local-only playback commands", async () => {
    const props = createProps({ isPlaying: true });
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(hook.result.current.togglePlay({ broadcast: false, forcePlaying: false })).resolves.toBe(true);
    verify([props.setIsPlaying, "toHaveBeenCalledWith", false], [props.onlineRoom.syncCommand, "not.toHaveBeenCalled"]);
    props.setIsPlaying.mockClear();
    await expect(hook.result.current.togglePlay({ broadcast: false, forcePlaying: true })).resolves.toBe(true);
    verify([props.setIsPlaying, "toHaveBeenCalledWith", true], [props.onlineRoom.syncCommand, "not.toHaveBeenCalled"]);
  });
  test("resumes a prepared recording without starting a replacement", async () => {
    const props = createProps({ recordingSessionId: "prepared" });
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(hook.result.current.togglePlay({ forcePlaying: true })).resolves.toBe(true);
    verify(
      [api.resumeRecording, "toHaveBeenCalledWith", "prepared"],
      [api.startRecording, "not.toHaveBeenCalled"],
      [props.setRecordingError, "toHaveBeenCalledWith", null]
    );
  });
  test("continues karaoke when recording start or resume fails", async () => {
    const startProps = createProps();
    api.startRecording.mockRejectedValueOnce(new Error("microphone missing"));
    const start = renderHook(() => useKaraokeTransport(startProps));
    await expect(start.result.current.togglePlay()).resolves.toBe(true);
    expect(startProps.instrumentalRef.current.play).toHaveBeenCalled();
    verify([startProps.setRecordingError, "toHaveBeenCalledWith", expect.stringContaining("microphone missing")]);
    start.unmount();
    const resumeProps = createProps({ recordingSessionId: "existing" });
    api.resumeRecording.mockRejectedValueOnce(new Error("resume failed"));
    const resume = renderHook(() => useKaraokeTransport(resumeProps));
    await expect(resume.result.current.togglePlay({ forcePlaying: true })).resolves.toBe(true);
    calledWith([api.stopRecording, ["existing"]], [resumeProps.setRecordingSessionId, [null]]);
    verify([resumeProps.setRecordingError, "toHaveBeenCalledWith", expect.stringContaining("resume failed")]);
  });
  test("handles a null recording response as a non-fatal recording failure", async () => {
    api.startRecording.mockResolvedValueOnce(null);
    const props = createProps();
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(hook.result.current.togglePlay({ forcePlaying: true })).resolves.toBe(true);
    verify([
      props.setRecordingError,
      "toHaveBeenCalledWith",
      "Запис недоступний, караоке продовжить роботу без нього: Backend не повернув ідентифікатор запису"
    ]);
  });
  test("rolls playback back when the master media cannot start", async () => {
    const props = createProps();
    props.instrumentalRef.current.play.mockRejectedValue(new Error("codec"));
    const { result } = renderHook(() => useKaraokeTransport(props));
    await expect(result.current.togglePlay()).resolves.toBe(false);
    verify([props.instrumentalRef.current.pause, "toHaveBeenCalled"], [api.pauseRecording, "not.toHaveBeenCalled"]);
    expect(props.syncSecondaryMedia).toHaveBeenNthCalledWith(1, 4, true);
    calledWith([props.setIsPlaying, [false]], [props.setRecordingError, ["Не вдалося запустити відтворення"]]);
  });
  test("does not pause a missing recording after media startup fails", async () => {
    api.startRecording.mockRejectedValueOnce(new Error("no microphone"));
    const props = createProps();
    props.instrumentalRef.current.play.mockRejectedValue(new Error("codec"));
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(hook.result.current.togglePlay({ forcePlaying: true })).resolves.toBe(false);
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
    await expect(hook.result.current.togglePlay({ forcePlaying: true })).resolves.toBe(true);
    expect(props.instrumentalRef.current.play).toHaveBeenCalledOnce();
    expect(props.setIsPlaying).toHaveBeenCalledWith(true);
  });
  test("does not block resumed playback on a stalled optional video", async () => {
    const props = createProps();
    props.videoRef.current.play.mockReturnValue(new Promise(() => {}));
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(hook.result.current.togglePlay({ forcePlaying: true })).resolves.toBe(true);
    expect(props.setIsPlaying).toHaveBeenCalledWith(true);
  });
  test("seeks, skips, stops and returns to the library", async () => {
    const props = createProps({ recordingSessionId: "existing" });
    const { result } = renderHook(() => useKaraokeTransport(props));
    act(() => result.current.seekTo(500));
    verify([props.instrumentalRef.current.currentTime, "toBe", 100], [props.setCurrentTime, "toHaveBeenCalledWith", 100]);
    verify([
      props.onlineRoom.syncCommand,
      "toHaveBeenLastCalledWith",
      expect.objectContaining({ type: "karaoke-player", action: "seek", songId: "song", position: 100 })
    ]);
    act(() => result.current.skip(-10));
    expect(props.instrumentalRef.current.currentTime).toBe(0);
    await expect(result.current.stop()).resolves.toBe(true);
    expect(props.syncSecondaryMedia).toHaveBeenLastCalledWith(0, true);
    expect(props.setIsPlaying).toHaveBeenLastCalledWith(false);
    expect(props.releaseMonitoring).toHaveBeenCalledOnce();
    calledWith([api.stopRecording, ["existing"]], [props.setAnalysisRecordingId, ["recording"]], [props.setRecordingSessionId, [null]]);
    props.onlineRoom.syncCommand.mockClear();
    await result.current.returnToLibrary();
    verify([props.onlineRoom.syncCommand, "not.toHaveBeenCalledWith", expect.objectContaining({ action: "stop" })]);
    calledWith([props.onlineRoom.syncCommand, [{ type: "open-library" }]], [props.navigate, ["/"]]);
  });
  test("clamps invalid seeks and supports local-only seek and stop", async () => {
    const props = createProps({ recordingSessionId: "existing" });
    const hook = renderHook(() => useKaraokeTransport(props));
    act(() => hook.result.current.seekTo(Number.NaN, { broadcast: false }));
    expect(props.instrumentalRef.current.currentTime).toBe(0);
    expect(props.syncSecondaryMedia).toHaveBeenLastCalledWith(0, true);
    expect(props.onlineRoom.syncCommand).not.toHaveBeenCalled();
    await expect(hook.result.current.stop({ broadcast: false })).resolves.toBe(true);
    expect(props.onlineRoom.syncCommand).not.toHaveBeenCalled();
  });
  test("default stop broadcasts the exact room command", async () => {
    const props = createProps();
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(hook.result.current.stop()).resolves.toBe(true);
    verify([
      props.onlineRoom.syncCommand,
      "toHaveBeenCalledWith",
      expect.objectContaining({ type: "karaoke-player", action: "stop", songId: "song", position: 0 })
    ]);
  });
  test("already-stopped room exit broadcasts library navigation without stopping twice", async () => {
    const props = createProps();
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(hook.result.current.returnToLibrary({ alreadyStopped: true, analysisId: "recording-room" })).resolves.toBe(true);
    expect(props.instrumentalRef.current.pause).not.toHaveBeenCalled();
    expect(props.onlineRoom.syncCommand).toHaveBeenCalledWith({ type: "open-library" });
    expect(props.navigate).toHaveBeenCalledWith("/", {
      replace: true,
      state: { fromKaraokeFade: true, analysisRecordingId: "recording-room" }
    });
  });
  test("keeps a failed recording pending without blocking stop or exit", async () => {
    const props = createProps({ recordingSessionId: "existing" });
    api.stopRecording.mockRejectedValueOnce(new Error("disk full"));
    const { result } = renderHook(() => useKaraokeTransport(props));
    await expect(result.current.stop()).resolves.toBe(true);
    expect(api.pauseRecording).toHaveBeenCalledWith("existing");
    verify([JSON.parse(localStorage.getItem("karaoke-pending-recording-session")), "toEqual", { id: "existing" }]);
    verify(
      [props.setRecordingError, "toHaveBeenCalledWith", expect.stringContaining("disk full")],
      [props.setRecordingSessionId, "toHaveBeenCalledWith", null]
    );
    await expect(result.current.returnToLibrary()).resolves.toBe(true);
    expect(props.navigate).toHaveBeenCalledWith("/");
  });
  test("treats an already stopped recording session as finalized", async () => {
    const missing = Object.assign(new Error("session missing"), { status: 404 });
    api.stopRecording.mockRejectedValueOnce(missing);
    const props = createProps({ recordingSessionId: "stale" });
    localStorage.setItem("karaoke-pending-recording-session", JSON.stringify({ id: "stale" }));
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(hook.result.current.returnToLibrary()).resolves.toBe(true);
    verify(
      [api.pauseRecording, "not.toHaveBeenCalled"],
      [props.setRecordingError, "not.toHaveBeenCalled"],
      [props.setRecordingSessionId, "toHaveBeenCalledWith", null],
      [props.navigate, "toHaveBeenCalledWith", "/"]
    );
    expect(JSON.parse(localStorage.getItem("karaoke-pending-recording-session"))).toEqual({});
  });
  test("applies synchronized room player commands", async () => {
    const props = createProps();
    const hook = renderHook((value) => useKaraokeTransport(value), { initialProps: props });
    hook.rerender({
      ...props,
      onlineRoom: {
        ...props.onlineRoom,
        roomCommand: { type: "karaoke-player", songId: "song", action: "seek", position: 12 }
      }
    });
    expect(props.setCurrentTime).toHaveBeenCalledWith(12);
    hook.rerender({
      ...props,
      onlineRoom: {
        ...props.onlineRoom,
        roomCommand: { type: "karaoke-player", songId: "song", action: "play", position: 12 }
      }
    });
    await waitFor(() => expect(props.setIsPlaying).toHaveBeenCalledWith(true));
  });
  test("ignores a duplicate delivery of an already-applied room command", async () => {
    const props = createProps();
    const hook = renderHook((value) => useKaraokeTransport(value), { initialProps: props });
    hook.rerender({
      ...props,
      onlineRoom: {
        ...props.onlineRoom,
        roomCommand: { type: "karaoke-player", songId: "song", action: "seek", position: 12, commandId: "cmd-1" }
      }
    });
    expect(props.setCurrentTime).toHaveBeenCalledWith(12);
    props.setCurrentTime.mockClear();

    // Same commandId, a fresh object (a retried send or duplicate WS
    // delivery would not reuse the same reference either) -- must not seek
    // again.
    hook.rerender({
      ...props,
      onlineRoom: {
        ...props.onlineRoom,
        roomCommand: { type: "karaoke-player", songId: "song", action: "seek", position: 12, commandId: "cmd-1" }
      }
    });
    expect(props.setCurrentTime).not.toHaveBeenCalled();

    hook.rerender({
      ...props,
      onlineRoom: {
        ...props.onlineRoom,
        roomCommand: { type: "karaoke-player", songId: "song", action: "seek", position: 30, commandId: "cmd-2" }
      }
    });
    expect(props.setCurrentTime).toHaveBeenCalledWith(30);
  });
  test("corrects a synced position for measured delivery latency", async () => {
    const props = createProps();
    const hook = renderHook((value) => useKaraokeTransport(value), { initialProps: props });
    const now = Date.now();
    hook.rerender({
      ...props,
      onlineRoom: {
        ...props.onlineRoom,
        roomCommand: {
          type: "karaoke-player",
          songId: "song",
          action: "sync",
          position: 10,
          commandId: "cmd-sync",
          __serverSentAt: now - 2000,
          __receivedServerAt: now
        }
      }
    });
    // 10s position + ~2s measured delivery delay = seek to ~12s, not the raw 10s.
    expect(props.instrumentalRef.current.currentTime).toBeCloseTo(12, 0);
  });
  test("finishes an active session when the song changes or unmounts", async () => {
    const props = createProps({ recordingSessionId: "existing" });
    const hook = renderHook((value) => useKaraokeTransport(value), { initialProps: props });
    hook.rerender({ ...props, song: { id: "next" } });
    await act(async () => Promise.resolve());
    expect(api.stopRecording).toHaveBeenCalledWith("existing");
    hook.unmount();
  });
  test("song cleanup finishes the previous session, never its replacement", async () => {
    const initial = createProps({ recordingSessionId: "old-session" });
    const hook = renderHook((value) => useKaraokeTransport(value), { initialProps: initial });
    hook.rerender({ ...initial, song: { id: "next" }, recordingSessionId: "new-session" });
    await act(async () => Promise.resolve());
    verify([api.stopRecording, "toHaveBeenCalledWith", "old-session"], [api.stopRecording, "not.toHaveBeenCalledWith", "new-session"]);
    hook.unmount();
  });
  test("finalizes a durable previous-song session exactly once and starts a fresh session", async () => {
    const props = createProps();
    const hook = renderHook((value) => useKaraokeTransport(value), { initialProps: props });
    await expect(hook.result.current.togglePlay({ forcePlaying: true })).resolves.toBe(true);
    await waitFor(() => expect(localStorage.getItem("karaoke-pending-recording-session")).toContain("session"));
    api.startRecording.mockResolvedValueOnce({ recording_session_id: "session-2" });
    hook.rerender({ ...props, song: { id: "next" }, recordingSessionId: "session" });
    await waitFor(() => expect(api.stopRecording).toHaveBeenCalledWith("session"));
    expect(api.stopRecording).toHaveBeenCalledTimes(1);
    const nextProps = { ...props, song: { id: "next" }, recordingSessionId: null };
    hook.rerender(nextProps);
    await expect(hook.result.current.togglePlay({ forcePlaying: true })).resolves.toBe(true);
    await waitFor(() => expect(api.startRecording).toHaveBeenCalledTimes(2));
    expect(api.resumeRecording).not.toHaveBeenCalledWith("session");
    hook.unmount();
  });
  test("falls back to pausing when cleanup cannot finish a session", async () => {
    api.stopRecording.mockRejectedValueOnce(new Error("stop failed"));
    api.pauseRecording.mockRejectedValueOnce(new Error("pause failed"));
    const hook = renderHook(() => useKaraokeTransport(createProps({ recordingSessionId: "cleanup-session" })));
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
    const starting = pauseHook.result.current.togglePlay({ forcePlaying: true });
    await act(async () => Promise.resolve());
    await pauseHook.result.current.togglePlay({ forcePlaying: false });
    await expect(starting).resolves.toBe(true);
    releasePause({ recording_session_id: "late-pause" });
    await waitFor(() => expect(api.pauseRecording).toHaveBeenCalledWith("late-pause"));
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
    const secondStart = stopHook.result.current.togglePlay({ forcePlaying: true });
    await act(async () => Promise.resolve());
    await stopHook.result.current.stop();
    await expect(secondStart).resolves.toBe(true);
    releaseStop({ recording_session_id: "late-stop" });
    await waitFor(() => expect(api.stopRecording).toHaveBeenCalledWith("late-stop"));
    calledWith([api.pauseRecording, ["late-stop"]], [stopProps.setRecordingSessionId, [null]]);
    stopHook.unmount();
  });
  test("finalizes a recording start that resolves after unmount", async () => {
    let releaseStart;
    api.startRecording.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseStart = resolve;
      })
    );
    const hook = renderHook(() => useKaraokeTransport(createProps()));
    await expect(hook.result.current.togglePlay({ forcePlaying: true })).resolves.toBe(true);
    hook.unmount();
    releaseStart({ recording_session_id: "late-unmount" });
    await waitFor(() => expect(api.stopRecording).toHaveBeenCalledWith("late-unmount"));
  });
  test("applies room pause and stop commands and reports rejected room play", async () => {
    const props = createProps({ recordingSessionId: "existing" });
    const hook = renderHook((value) => useKaraokeTransport(value), { initialProps: props });
    for (const action of ["pause", "stop"]) {
      hook.rerender({
        ...props,
        onlineRoom: {
          ...props.onlineRoom,
          roomCommand: { type: "karaoke-player", songId: "song", action, position: 2 }
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
          roomCommand: { type: "karaoke-player", songId: "song", action: "play" }
        }
      })
    );
    await waitFor(() => expect(throwingProps.setIsPlaying).toHaveBeenCalledWith(true));
  });
  test("ignores unrelated, malformed and unknown room commands", async () => {
    const props = createProps();
    const hook = renderHook((value) => useKaraokeTransport(value), { initialProps: props });
    const commands = [
      { type: "other", songId: "song", action: "play", position: 5 },
      { type: "karaoke-player", songId: "other", action: "play", position: 5 },
      { type: "karaoke-player", songId: "song", action: "unknown", position: "not-finite" },
      { type: "karaoke-player", songId: "song", action: "toString" },
      { type: "karaoke-player", songId: "song", action: "__proto__" }
    ];
    for (const roomCommand of commands) {
      hook.rerender({ ...props, onlineRoom: { ...props.onlineRoom, roomCommand } });
      await act(async () => Promise.resolve());
    }
    notCalled(props.instrumentalRef.current.play, props.instrumentalRef.current.pause, props.setCurrentTime, props.onlineRoom.syncCommand);
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
            roomCommand: { type: "karaoke-player", songId: "song", action, position: 7 }
          }
        })
      );
      await waitFor(() => expect(props.setCurrentTime).toHaveBeenCalledWith(action === "stop" ? 0 : 7));
      expect(props.onlineRoom.syncCommand).not.toHaveBeenCalled();
      if (action === "pause") {
        verify([props.setIsPlaying, "toHaveBeenCalledWith", false], [props.instrumentalRef.current.play, "not.toHaveBeenCalled"]);
      }
      hook.unmount();
    }
  });
  test("isolates every best-effort recording cleanup failure", async () => {
    const run = async (props, configure, action) => {
      localStorage.clear();
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
      createProps({ isPlaying: true, recordingSessionId: "existing" }),
      () => api.pauseRecording.mockRejectedValueOnce(new Error("pause")),
      ({ togglePlay }) => togglePlay({ forcePlaying: false })
    );
    await run(
      createProps({ startMelodyGuide: vi.fn().mockRejectedValue(new Error("guide")) }),
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
    failedMaster.instrumentalRef.current.play.mockRejectedValue(new Error("play"));
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
    notCalled(props.setCurrentTime, props.syncSecondaryMedia);
  });
  test("continues playback when recording starts without a session id", async () => {
    api.startRecording.mockResolvedValueOnce({});
    const props = createProps({ onlineRoom: null });
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(hook.result.current.togglePlay({ forcePlaying: true })).resolves.toBe(true);
    called(props.setRecordingError, props.instrumentalRef.current.play);
  });
  test("does not block playback on a stalled recording start and settles it after stop", async () => {
    let releaseStart;
    api.startRecording.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseStart = resolve;
      })
    );
    const props = createProps();
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(hook.result.current.togglePlay({ forcePlaying: true })).resolves.toBe(true);
    expect(props.instrumentalRef.current.play).toHaveBeenCalledOnce();
    await waitFor(() => expect(releaseStart).toBeTypeOf("function"));
    await hook.result.current.stop();
    releaseStart({ recording_session_id: "late" });
    await waitFor(() => expect(api.stopRecording).toHaveBeenCalledWith("late"));
  });
  test("settles playback superseded by a later stop", async () => {
    let releasePlay;
    const playbackProps = createProps();
    playbackProps.instrumentalRef.current.play.mockReturnValueOnce(
      new Promise((resolve) => {
        releasePlay = resolve;
      })
    );
    const playbackHook = renderHook(() => useKaraokeTransport(playbackProps));
    const playback = playbackHook.result.current.togglePlay({ forcePlaying: true });
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
    await expect(hook.result.current.togglePlay({ forcePlaying: true })).resolves.toBe(true);
    props.setRecordingError.mockClear();
    api.stopRecording.mockResolvedValueOnce(null);
    await expect(hook.result.current.stop()).resolves.toBe(true);
    notCalled(props.setAnalysisRecordingId, props.setRecordingError);
    await hook.result.current.returnToLibrary();
    expect(props.navigate).toHaveBeenCalledWith("/");
    api.startRecording.mockRejectedValueOnce(new Error("no recording"));
    const failedProps = createProps({
      onlineRoom: null,
      vocalsRef: { current: null },
      videoRef: { current: null }
    });
    failedProps.instrumentalRef.current.play.mockRejectedValueOnce(new Error("no media"));
    const failed = renderHook(() => useKaraokeTransport(failedProps));
    await expect(failed.result.current.togglePlay({ forcePlaying: true })).resolves.toBe(false);
  });
  test("does not publish an analysis id when recording save has no id", async () => {
    api.stopRecording.mockResolvedValueOnce({});
    const props = createProps({ recordingSessionId: "existing" });
    const hook = renderHook(() => useKaraokeTransport(props));
    await expect(hook.result.current.stop()).resolves.toBe(true);
    notCalled(props.setAnalysisRecordingId, props.setRecordingError);
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
    await shared.result.current.togglePlay({ broadcast: false, forcePlaying: true });
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
    const oldPlayback = changing.result.current.togglePlay({ forcePlaying: true });
    changing.rerender({ ...createProps(), song: { id: "new-song" } });
    await expect(oldPlayback).resolves.toBe(true);
    releaseOld({ recording_session_id: "old" });
    await waitFor(() => expect(api.stopRecording).toHaveBeenCalledWith("old"));
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
    const hook = renderHook((value) => useKaraokeTransport(value), { initialProps: initial });
    const oldPlayback = hook.result.current.togglePlay({ forcePlaying: true });
    hook.rerender({ ...initial, song: { id: "new-song" } });
    const newPlayback = hook.result.current.togglePlay({ forcePlaying: true });
    await expect(oldPlayback).resolves.toBe(true);
    releaseOld({ recording_session_id: "old" });
    await waitFor(() => expect(api.stopRecording).toHaveBeenCalledWith("old"));
    const sharedNewPlayback = hook.result.current.togglePlay({ forcePlaying: true });
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
    const hook = renderHook((value) => useKaraokeTransport(value), { initialProps: props });
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
    const hook = renderHook((value) => useKaraokeTransport(value), { initialProps: props });
    hook.rerender({ ...props, isPlaying: true, recordingSessionId: "external" });
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
          roomCommand: { type: "karaoke-player", songId: "song", action: "pause", position: 2 }
        }
      })
    );
    await waitFor(() => expect(props.setRecordingError).toHaveBeenCalledWith(expect.stringContaining("room transport exploded")));
  });
  test("ignores room commands safely when no song is loaded", () => {
    const props = createProps({ song: null });
    verify([
      () =>
        renderHook(() =>
          useKaraokeTransport({
            ...props,
            onlineRoom: {
              ...props.onlineRoom,
              roomCommand: { type: "karaoke-player", songId: "song", action: "play", position: 1 }
            }
          })
        ),
      "not.toThrow"
    ]);
  });
});
