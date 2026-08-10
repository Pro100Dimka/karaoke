import { useEffect, useRef } from "react";
import { api } from "../../../api/client";
import useLatestRef from "../../../hooks/useLatestRef";
import { getErrorMessage } from "../../../utils/errors";
import { playbackGain } from "../utils/data";
import {
  clampPlaybackPosition,
  createPlayerSyncCommand
} from "../utils/transport";

export default function useKaraokeTransport({
  song,
  onlineRoom,
  navigate,
  instrumentalRef,
  vocalsRef,
  videoRef,
  browserMonitorRef,
  durationRef,
  currentTime,
  duration,
  isPlaying,
  recordingSessionId,
  musicVolume,
  vocalVolume,
  microphoneVolume,
  microphoneEffects,
  startMelodyGuide,
  silenceMelodyGuide,
  sendYouTubeCommand,
  syncSecondaryMedia,
  setCurrentTime,
  setIsPlaying,
  setMonitoringEnabled,
  setRecordingError,
  setRecordingSessionId,
  setAnalysisRecordingId
}) {
  const operationRef = useRef(0);
  const latestOperationTypeRef = useRef("idle");
  const recordingSessionRef = useRef(recordingSessionId);
  const recordingStartPromiseRef = useRef(null);

  recordingSessionRef.current = recordingSessionId;

  useEffect(() => {
    operationRef.current += 1;
    latestOperationTypeRef.current = "song-change";
    recordingStartPromiseRef.current = null;

    return () => {
      const sessionId = recordingSessionRef.current;
      recordingSessionRef.current = null;
      if (!sessionId) return;

      // A route/song change must never leave a backend recording session alive.
      // Try to finish it; if the backend cannot save it, at least pause it.
      api.stopRecording(sessionId).catch(() =>
        api.pauseRecording(sessionId).catch(() => {})
      );
    };
  }, [song?.id]);

  const broadcastCommand = (action, position) => {
    if (!onlineRoom?.room || !song?.id) return;
    onlineRoom.syncCommand(createPlayerSyncCommand(action, song.id, position));
  };

  const pausePlaybackResources = () => {
    instrumentalRef.current?.pause();
    vocalsRef.current?.pause();
    videoRef.current?.pause();
    sendYouTubeCommand("pauseVideo");
    silenceMelodyGuide();
  };

  const preparePlayback = async () => {
    const instr = instrumentalRef.current;
    const voc = vocalsRef.current;
    if (!instr || !voc || !song?.id || recordingSessionRef.current) return true;

    // Warm up the backend recording session while the cinematic intro is
    // still on screen. The session is paused immediately, so actual recording
    // starts only together with playback. This removes the visible delay after
    // the blackout has fully revealed the scene.
    try {
      const session = await api.startRecording(
        song.id,
        instr.currentTime,
        playbackGain(musicVolume),
        microphoneVolume,
        microphoneEffects.reverb,
        microphoneEffects.echo,
        microphoneEffects.delay
      );
      const sessionId = session?.recording_session_id;
      if (!sessionId) throw new Error("Backend не вернул идентификатор записи");

      try {
        await api.pauseRecording(sessionId);
      } catch (pauseError) {
        await api.stopRecording(sessionId).catch(() => {});
        throw pauseError;
      }

      recordingSessionRef.current = sessionId;
      setRecordingSessionId(sessionId);
      setRecordingError(null);
      return true;
    } catch (error) {
      setRecordingError(
        `Не удалось подготовить запись: ${getErrorMessage(error, "неизвестная ошибка")}`
      );
      return false;
    }
  };

  const togglePlay = async ({ broadcast = true, forcePlaying = null } = {}) => {
    const instr = instrumentalRef.current;
    const voc = vocalsRef.current;
    if (!instr || !voc || !song?.id) return undefined;

    const operationId = ++operationRef.current;
    const shouldPlay = forcePlaying == null ? !isPlaying : forcePlaying;
    latestOperationTypeRef.current = shouldPlay ? "play" : "pause";

    if (!shouldPlay) {
      pausePlaybackResources();
      setIsPlaying(false);
      const sessionId = recordingSessionRef.current;
      if (sessionId) {
        await api.pauseRecording(sessionId).catch(() => {});
      }
      if (broadcast) broadcastCommand("pause", instr.currentTime);
      return true;
    }

    // Start the melody guide and resume an already-prepared recording in
    // parallel with media playback. Waiting for backend/audio-context round
    // trips here used to create a noticeable pause after the reveal.
    const melodyStart = startMelodyGuide().catch(() => {});
    let activeRecordingId = recordingSessionRef.current;
    let recordingResume = Promise.resolve();

    try {
      if (activeRecordingId) {
        recordingResume = api
          .resumeRecording(activeRecordingId)
          .catch((error) => {
            setRecordingError(
              `Не удалось возобновить запись: ${getErrorMessage(error, "неизвестная ошибка")}`
            );
            return null;
          });
      } else {
        if (!recordingStartPromiseRef.current) {
          const startPromise = api
            .startRecording(
              song.id,
              instr.currentTime,
              playbackGain(musicVolume),
              microphoneVolume,
              microphoneEffects.reverb,
              microphoneEffects.echo,
              microphoneEffects.delay
            )
            .finally(() => {
              if (recordingStartPromiseRef.current === startPromise) {
                recordingStartPromiseRef.current = null;
              }
            });
          recordingStartPromiseRef.current = startPromise;
        }
        const session = await recordingStartPromiseRef.current;
        activeRecordingId = session.recording_session_id;
        if (!activeRecordingId) {
          throw new Error("Backend не вернул идентификатор записи");
        }
        recordingSessionRef.current = activeRecordingId;
        setRecordingSessionId(activeRecordingId);
      }
      setRecordingError(null);
    } catch (error) {
      silenceMelodyGuide();
      setRecordingError(
        `Не удалось начать запись: ${getErrorMessage(error, "неизвестная ошибка")}`
      );
      return false;
    }

    if (operationId !== operationRef.current) {
      if (latestOperationTypeRef.current !== "play" && activeRecordingId) {
        await api.pauseRecording(activeRecordingId).catch(() => {});
      }
      silenceMelodyGuide();
      return false;
    }

    syncSecondaryMedia(instr.currentTime, true);
    instr.volume = playbackGain(musicVolume);
    voc.volume = playbackGain(vocalVolume);
    sendYouTubeCommand("playVideo");

    try {
      await instr.play();
      await Promise.allSettled(
        [
          voc.play(),
          videoRef.current?.play(),
          melodyStart,
          recordingResume
        ].filter(Boolean)
      );
    } catch {
      pausePlaybackResources();
      if (activeRecordingId) {
        await api.pauseRecording(activeRecordingId).catch(() => {});
      }
      setIsPlaying(false);
      setRecordingError("Не удалось запустить воспроизведение");
      return false;
    }

    if (operationId !== operationRef.current) {
      pausePlaybackResources();
      if (activeRecordingId) {
        await api.pauseRecording(activeRecordingId).catch(() => {});
      }
      return false;
    }

    setIsPlaying(true);
    if (broadcast) broadcastCommand("play", instr.currentTime);
    return true;
  };

  const stop = async ({ broadcast = true } = {}) => {
    const instr = instrumentalRef.current;
    const voc = vocalsRef.current;
    if (!instr || !voc || !song?.id) return undefined;

    operationRef.current += 1;
    latestOperationTypeRef.current = "stop";
    pausePlaybackResources();
    instr.currentTime = 0;
    syncSecondaryMedia(0, true);
    setIsPlaying(false);
    setCurrentTime(0);
    if (broadcast) broadcastCommand("stop", 0);

    const activeRecordingId = recordingSessionRef.current;
    if (activeRecordingId) {
      try {
        const recording = await api.stopRecording(activeRecordingId);
        if (recording?.id) setAnalysisRecordingId(recording.id);
      } catch (error) {
        await api.pauseRecording(activeRecordingId).catch(() => {});
        setRecordingError(
          `Не удалось сохранить запись: ${getErrorMessage(error, "неизвестная ошибка")}`
        );
      } finally {
        recordingSessionRef.current = null;
        setRecordingSessionId(null);
      }
    }

    const monitor = browserMonitorRef.current;
    monitor?.stream?.getTracks?.().forEach((track) => track.stop());
    const closeResult = monitor?.context?.close?.();
    await closeResult?.catch?.(() => {});
    browserMonitorRef.current = null;
    setMonitoringEnabled(false);
    await api.stopDirectMonitoring().catch(() => {});
    return true;
  };

  const seekTo = (time, { broadcast = true } = {}) => {
    const instr = instrumentalRef.current;
    if (!instr || !song?.id) return;

    const position = clampPlaybackPosition(time, durationRef.current);
    instr.currentTime = position;
    syncSecondaryMedia(position, true);
    setCurrentTime(position);
    if (broadcast) broadcastCommand("seek", position);
  };

  const skip = (delta) =>
    seekTo(clampPlaybackPosition(currentTime + delta, duration));

  const returnToLibrary = async () => {
    await stop({ broadcast: false });
    if (onlineRoom?.room) onlineRoom.syncCommand({ type: "open-library" });
    navigate("/");
  };

  const togglePlayRef = useLatestRef(togglePlay);
  const seekToRef = useLatestRef(seekTo);
  const stopRef = useLatestRef(stop);
  const roomCommand = onlineRoom?.roomCommand;

  useEffect(() => {
    if (
      roomCommand?.type !== "karaoke-player" ||
      !song?.id ||
      roomCommand.songId !== song.id ||
      !instrumentalRef.current
    ) {
      return;
    }

    const position = Number(roomCommand.position);
    if (Number.isFinite(position)) {
      seekToRef.current(position, { broadcast: false });
    }

    const roomActions = {
      play: () =>
        togglePlayRef.current({ broadcast: false, forcePlaying: true }),
      pause: () =>
        togglePlayRef.current({ broadcast: false, forcePlaying: false }),
      stop: () => stopRef.current({ broadcast: false })
    };

    Promise.resolve(roomActions[roomCommand.action]?.()).catch((error) => {
      setRecordingError(
        `Не удалось выполнить команду комнаты: ${getErrorMessage(
          error,
          "неизвестная ошибка"
        )}`
      );
    });
  }, [
    instrumentalRef,
    roomCommand,
    seekToRef,
    setRecordingError,
    song?.id,
    stopRef,
    togglePlayRef
  ]);

  return { preparePlayback, returnToLibrary, seekTo, skip, stop, togglePlay };
}
