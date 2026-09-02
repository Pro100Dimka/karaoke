import { useEffect, useRef } from "react";
import { api } from "../../../api/client";
import useLatestRef from "../../../hooks/useLatestRef";
import { translateSaved } from "../../../i18n/runtime";
import { createRoomSyncChannel } from "../../../services/roomSyncChannel";
import { createRoomVoiceCapture } from "../../../services/roomVoiceCapture";
import { playbackGain } from "../utils/data";
import { finalizeRecording, formatError } from "../utils/recordingSession";
import { clampPlaybackPosition, createPlayerSyncCommand } from "../utils/transport";
import useKaraokeRecording from "./useKaraokeRecording";

export { createRoomVoiceCapture } from "../../../services/roomVoiceCapture";
const ROOM_PLAY_LEAD_MS = 450;
const MASTER_PLAY_TIMEOUT_MS = 4_000;
const wait = (milliseconds) =>
  new Promise((resolve) => globalThis.setTimeout(resolve, Math.max(0, milliseconds)));
const startMasterMedia = async (media) => {
  const started = Promise.resolve(media.play());
  let timer;
  try {
    await Promise.race([
      started,
      new Promise((_, reject) => {
        timer = globalThis.setTimeout(
          () => reject(new Error("Master media playback timed out")),
          MASTER_PLAY_TIMEOUT_MS
        );
      })
    ]);
  } catch (error) {
    // Some Electron/Chromium builds leave play() pending even after the media
    // has actually entered playback. Treat an observably playing element as
    // success, but never leave the state machine stuck in `starting`.
    if (media.paused !== false) throw error;
  } finally {
    globalThis.clearTimeout(timer);
  }
};
export default function useKaraokeTransport({
  song,
  onlineRoom,
  navigate,
  instrumentalRef,
  vocalsRef,
  videoRef,
  durationRef,
  currentTime,
  duration,
  isPlaying,
  recordingSessionId,
  musicVolume,
  speed,
  vocalVolume,
  microphoneVolume,
  microphoneEffects,
  startMelodyGuide,
  silenceMelodyGuide,
  sendYouTubeCommand,
  syncSecondaryMedia,
  setCurrentTime,
  setIsPlaying,
  playback,
  releaseMonitoring,
  setRecordingError,
  setRecordingSessionId,
  setAnalysisRecordingId
}) {
  const lifecycle = playback ?? {
    start: () => {},
    played: () => setIsPlaying(true),
    pause: () => {},
    paused: () => setIsPlaying(false),
    stop: () => {},
    stopped: () => setIsPlaying(false),
    fail: () => setIsPlaying(false)
  };
  const operationRef = useRef(Symbol("karaoke-operation"));
  const roomCaptureRef = useRef(null);
  const stopVersionRef = useRef(0);
  const { sessionRef, pendingRecordingStartRef, clearSession, discardSession, runRecording,
    pauseRecording, flushRecordingControls } = useKaraokeRecording({
    song,
    onlineRoom,
    instrumentalRef,
    musicVolume,
    speed,
    microphoneVolume,
    microphoneEffects,
    recordingSessionId,
    setRecordingSessionId,
    setRecordingError,
    setAnalysisRecordingId,
    operationRef,
    roomCaptureRef
  });
  const beginOperation = () => (operationRef.current = Symbol("karaoke-operation"));

  const broadcast = (action, position, executeAt = null) => {
    if (onlineRoom?.room)
      onlineRoom.syncCommand(createPlayerSyncCommand(action, song.id, position, executeAt));
  };
  const roomSyncCommand = onlineRoom?.syncCommand;
  const roomClockNow = onlineRoom?.roomClockNow;
  useEffect(() => {
    if (!onlineRoom?.room?.host || !isPlaying || !song?.id) return undefined;
    const timer = globalThis.setInterval(() => {
      const position = instrumentalRef.current?.currentTime;
      if (Number.isFinite(position))
        roomSyncCommand(createPlayerSyncCommand("sync", song.id, position));
    }, 500);
    return () => globalThis.clearInterval(timer);
  }, [instrumentalRef, isPlaying, onlineRoom?.room?.host, roomSyncCommand, song?.id]);

  const pauseMedia = () => {
    instrumentalRef.current?.pause();
    vocalsRef.current?.pause();
    videoRef.current?.pause();
    sendYouTubeCommand("pauseVideo");
    silenceMelodyGuide();
  };

  const startOrResumeRoomCapture = async (position) => {
    if (!onlineRoom?.room) return null;
    if (roomCaptureRef.current) {
      roomCaptureRef.current.resume();
      return roomCaptureRef.current;
    }
    const capture = await createRoomVoiceCapture(
      onlineRoom.getRemoteVoiceStreams?.() || [],
      position
    ).catch(() => null);
    roomCaptureRef.current = capture;
    return capture;
  };

  const stopRoomCapture = () => {
    const capture = roomCaptureRef.current;
    roomCaptureRef.current = null;
    if (!capture) return Promise.resolve(null);
    return Promise.resolve(capture.stop()).then((blob) => ({
      blob,
      startPlaybackSec: capture.startPlaybackSec
    }));
  };

  const togglePlay = async ({ broadcast: shouldBroadcast = true, forcePlaying = null } = {}) => {
    const instrumental = instrumentalRef.current;
    const vocals = vocalsRef.current;
    if (!instrumental || !song?.id) return undefined;
    const shouldPlay = forcePlaying ?? !isPlaying;
    const operation = beginOperation();
    const stopVersion = stopVersionRef.current;

    if (!shouldPlay) {
      lifecycle.pause();
      const pendingStart = pendingRecordingStartRef.current;
      if (!sessionRef.current && pendingStart && pendingStart.songId === song.id)
        pendingStart.settle = "pause";
      pauseMedia();
      roomCaptureRef.current?.pause();
      // setCurrentTime is throttled during playback (see useKaraokeMediaSync),
      // so the last published value can be briefly behind the exact moment
      // playback actually stopped -- resync it here rather than leaving the
      // paused timecode/lyrics highlight a fraction of a second stale.
      setCurrentTime(instrumental.currentTime);
      lifecycle.paused();
      if (shouldBroadcast) broadcast("pause", instrumental.currentTime);
      // Room transport must not wait for a local recording driver/backend.
      if (sessionRef.current) await pauseRecording(sessionRef.current).catch(() => {});
      return true;
    }

    lifecycle.start();

    const scheduledAt =
      shouldBroadcast && onlineRoom?.room && typeof onlineRoom.roomClockNow === "function"
        ? onlineRoom.roomClockNow() + ROOM_PLAY_LEAD_MS
        : null;
    if (scheduledAt != null) broadcast("play", instrumental.currentTime, scheduledAt);

    const melodyStart = Promise.resolve()
      .then(startMelodyGuide)
      .catch(() => {});
    syncSecondaryMedia(instrumental.currentTime, true);
    instrumental.volume = playbackGain(musicVolume);
    if (vocals) vocals.volume = playbackGain(vocalVolume);
    sendYouTubeCommand("playVideo");

    const recordingStart = runRecording(operation);
    try {
      await Promise.race([recordingStart, wait(ROOM_PLAY_LEAD_MS)]);
      if (scheduledAt != null) await wait(scheduledAt - onlineRoom.roomClockNow());
      await startOrResumeRoomCapture(instrumental.currentTime);
      const master = startMasterMedia(instrumental);
      const secondary = [
        vocals && Promise.resolve(vocals.play()),
        videoRef.current && Promise.resolve(videoRef.current.play()),
        melodyStart
      ].filter(Boolean);
      // Electron can leave an optional video/audio play() promise pending
      // after pause/stop. Only the instrumental is the master clock, so an
      // optional follower must never keep the playback machine in `starting`.
      secondary.forEach((start) => Promise.resolve(start).catch(() => {}));
      const [masterResult] = await Promise.allSettled([master]);
      if (masterResult.status === "rejected") throw masterResult.reason;
      syncSecondaryMedia(instrumental.currentTime, true);
      // Recording startup may wait for an audio driver. Playback must remain
      // instant; anchor it as soon as the session is ready, using the media
      // position and microphone frame observed at that exact later moment.
      recordingStart.then((recordingId) => {
        if (!recordingId || operation !== operationRef.current) return;
        Promise.resolve(api.syncRecording(recordingId, instrumental.currentTime, speed)).catch(
          (error) => {
            if (operation === operationRef.current) {
              setRecordingError(formatError("karaoke.couldNotPreciselySynchronizeRecording", error));
            }
          }
        );
      });
    } catch {
      beginOperation();
      const pendingStart = pendingRecordingStartRef.current;
      if (pendingStart && pendingStart.songId === song.id) pendingStart.settle = "stop";
      pauseMedia();
      await stopRoomCapture().catch(() => null);
      const activeSession = sessionRef.current;
      if (activeSession) await discardSession(activeSession);
      lifecycle.fail();
      setRecordingError(translateSaved("karaoke.failedToStartPlayback"));
      if (scheduledAt != null) broadcast("pause", instrumental.currentTime);
      return false;
    }

    if (operation !== operationRef.current) {
      pauseMedia();
      return stopVersionRef.current === stopVersion;
    }
    lifecycle.played();
    if (shouldBroadcast && scheduledAt == null) broadcast("play", instrumental.currentTime);
    return true;
  };
  const stopInFlightRef = useRef(null); // coalesces a local stop with a concurrent room "stop"
  const stop = async ({ broadcast: shouldBroadcast = true } = {}) => {
    if (stopInFlightRef.current) return stopInFlightRef.current;
    const run = runStop(shouldBroadcast).finally(() => (stopInFlightRef.current = null));
    return (stopInFlightRef.current = run);
  };
  const runStop = async (shouldBroadcast) => {
    const instrumental = instrumentalRef.current;
    if (!instrumental || !song?.id) return undefined;
    lifecycle.stop();
    stopVersionRef.current += 1;
    beginOperation();
    const pendingStart = pendingRecordingStartRef.current;
    if (!sessionRef.current && pendingStart && pendingStart.songId === song.id)
      pendingStart.settle = "stop";
    pauseMedia();
    const roomAudio = stopRoomCapture();
    instrumental.currentTime = 0;
    syncSecondaryMedia(0, true);
    lifecycle.stopped();
    setCurrentTime(0);
    if (shouldBroadcast) broadcast("stop", 0);
    const id = sessionRef.current;
    if (id) {
      await flushRecordingControls();
      const { recording, error } = await finalizeRecording(id);
      if (error) {
        setRecordingError(formatError("karaoke.failedToSaveEntry", error));
        clearSession(id, false);
      } else {
        if (recording?.id) {
          const captured = await roomAudio.catch(() => null);
          if (captured?.blob?.size) {
            try {
              const compensation = await Promise.resolve(
                onlineRoom?.estimateRemoteVoiceLatency?.()
              ).catch(() => 0);
              await api.attachRoomAudio(
                recording.id,
                captured.blob,
                captured.startPlaybackSec,
                compensation
              );
            } catch (error) {
              setRecordingError(
                formatError("karaoke.recordingSavedButTheOtherParticipantSVoiceCould", error)
              );
            }
          }
          setAnalysisRecordingId(recording.id);
        }
        clearSession(id);
      }
    }
    try {
      // The backend restores direct monitoring when recording closes. Release
      // it again before opening the result player: Bluetooth cannot reliably
      // keep its Hands-Free microphone profile and play normal media at once.
      await Promise.resolve(releaseMonitoring?.());
    } catch (error) {
      setRecordingError(formatError("karaoke.couldNotDisableMicrophoneMonitoring", error));
    }
    return true;
  };

  const seekTo = (time, { broadcast: shouldBroadcast = true } = {}) => {
    const instrumental = instrumentalRef.current;
    if (!instrumental || !song?.id) return;
    const position = clampPlaybackPosition(time, durationRef.current);
    instrumental.currentTime = position;
    syncSecondaryMedia(position, true);
    setCurrentTime(position);
    if (isPlaying && sessionRef.current) {
      Promise.resolve(api.syncRecording(sessionRef.current, position, speed)).catch(() => {});
    }
    if (shouldBroadcast) broadcast("seek", position);
  };

  const skip = (delta) => seekTo(clampPlaybackPosition(currentTime + delta, duration));
  const returnToLibrary = async ({ alreadyStopped = false, analysisId = null } = {}) => {
    // Tell the room before waiting for this machine's recording/device cleanup.
    // Navigation elsewhere unmounts karaoke and finalizes each local recording.
    if (onlineRoom?.room) {
      Promise.resolve(onlineRoom.syncCommand({ type: "open-library" })).catch(() => {});
    }
    if (!alreadyStopped) {
      try {
        await stop({ broadcast: false });
      } catch (error) {
        setRecordingError(formatError("karaoke.failedToSaveEntry", error));
      }
    }
    if (alreadyStopped)
      navigate("/", {
        replace: true,
        state: { fromKaraokeFade: true, analysisRecordingId: analysisId || null }
      });
    else navigate("/");
    return true;
  };

  const togglePlayRef = useLatestRef(togglePlay);
  const seekToRef = useLatestRef(seekTo);
  const stopRef = useLatestRef(stop);
  const commandChannel = useRef(createRoomSyncChannel());
  useEffect(() => {
    commandChannel.current = createRoomSyncChannel();
  }, [onlineRoom?.room?.id, song?.id]);
  const roomCommand = onlineRoom?.roomCommand;
  useEffect(() => {
    if (
      roomCommand?.type !== "karaoke-player" ||
      !song?.id ||
      roomCommand.songId !== song.id ||
      !instrumentalRef.current
    )
      return;
    // A duplicate WebSocket delivery (or a retry after a flaky connection)
    // must not re-apply the same play/pause/seek a second time -- most
    // visibly, a repeated "seek" would otherwise snap playback backward.
    if (!commandChannel.current.acceptCommand(roomCommand.commandId)) return;

    const position = Number(roomCommand.position);
    const sampledAt = Number(roomCommand.positionAt);
    const sentAt =
      Number.isFinite(sampledAt) && roomCommand.positionAt != null
        ? sampledAt
        : Number(roomCommand.__serverSentAt);
    const receivedAt = Number(roomCommand.__receivedServerAt);
    const executeAt = Number(roomCommand.executeAt);
    const serverNow = typeof roomClockNow === "function" ? Number(roomClockNow()) : receivedAt;
    const deliverySeconds =
      ["play", "sync"].includes(roomCommand.action) &&
      Number.isFinite(sentAt) &&
      Number.isFinite(receivedAt)
        ? Math.max(0, (receivedAt - sentAt) / 1000)
        : 0;
    const scheduleLateness =
      roomCommand.action === "play" && Number.isFinite(executeAt) && Number.isFinite(serverNow)
        ? Math.max(0, (serverNow - executeAt) / 1000)
        : deliverySeconds;
    const targetPosition = position + scheduleLateness;
    if (
      Number.isFinite(targetPosition) &&
      (roomCommand.action !== "sync" ||
        Math.abs(instrumentalRef.current.currentTime - targetPosition) > 0.04)
    )
      seekToRef.current(targetPosition, { broadcast: false });
    const actions = {
      play: () => togglePlayRef.current({ broadcast: false, forcePlaying: true }),
      pause: () => togglePlayRef.current({ broadcast: false, forcePlaying: false }),
      stop: async () => {
        const stopped = await stopRef.current({ broadcast: false });
        if (stopped) navigate("/", { replace: true, state: { fromKaraokeFade: true } });
        return stopped;
      }
    };
    const action = Object.hasOwn(actions, roomCommand.action) && actions[roomCommand.action];
    const runAction = () =>
      Promise.resolve(action && action()).catch((error) =>
        setRecordingError(formatError("karaoke.failedToExecuteRoomCommand", error))
      );
    const delay =
      roomCommand.action === "play" && Number.isFinite(executeAt) && Number.isFinite(serverNow)
        ? Math.max(0, executeAt - serverNow)
        : 0;
    if (!action || delay <= 0) {
      runAction();
      return undefined;
    }
    let executed = false;
    const timer = globalThis.setTimeout(() => {
      executed = true;
      runAction();
    }, delay);
    return () => {
      globalThis.clearTimeout(timer);
      if (!executed) commandChannel.current.cancelCommand(roomCommand.commandId);
    };
  }, [
    instrumentalRef,
    navigate,
    roomCommand,
    roomClockNow,
    seekToRef,
    setRecordingError,
    song?.id,
    stopRef,
    togglePlayRef
  ]);

  return { returnToLibrary, seekTo, skip, stop, togglePlay };
}
