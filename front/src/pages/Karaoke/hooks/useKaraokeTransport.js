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
    recordingSessionRef.current = null;
  }, [song?.id]);

  const broadcastCommand = (action, position) => {
    if (!onlineRoom?.room || !song?.id) return;
    onlineRoom.syncCommand(
      createPlayerSyncCommand(action, song.id, position)
    );
  };

  const pausePlaybackResources = () => {
    instrumentalRef.current?.pause();
    vocalsRef.current?.pause();
    videoRef.current?.pause();
    sendYouTubeCommand("pauseVideo");
    silenceMelodyGuide();
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

    // Create/resume Web Audio while this call is still initiated by the user.
    const melodyStart = startMelodyGuide().catch(() => {});
    let activeRecordingId = recordingSessionRef.current;

    try {
      if (activeRecordingId) {
        await api.resumeRecording(activeRecordingId);
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
      if (
        latestOperationTypeRef.current !== "play" &&
        activeRecordingId
      ) {
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
      await melodyStart;
      await instr.play();
      await Promise.allSettled(
        [voc.play(), videoRef.current?.play()].filter(Boolean)
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
        recordingSessionRef.current = null;
        setRecordingSessionId(null);
        setAnalysisRecordingId(recording.id);
      } catch (error) {
        setRecordingError(
          `Не удалось сохранить запись: ${getErrorMessage(error, "неизвестная ошибка")}`
        );
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

  return { returnToLibrary, seekTo, skip, stop, togglePlay };
}
