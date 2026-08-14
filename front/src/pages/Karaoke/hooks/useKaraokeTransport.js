import { useEffect, useRef } from "react";
import { api } from "../../../api/client";
import useLatestRef from "../../../hooks/useLatestRef";
import { translateSaved } from "../../../i18n/runtime";
import { getErrorMessage } from "../../../utils/errors";
import { playbackGain } from "../utils/data";
import {
  clampPlaybackPosition,
  createPlayerSyncCommand
} from "../utils/transport";

const UNKNOWN_ERROR = "неизвестная ошибка";
const MISSING_RECORDING_ID = "Backend не вернул идентификатор записи";
const formatError = (message, error) =>
  translateSaved(message, {
    0: getErrorMessage(error, translateSaved(UNKNOWN_ERROR))
  });

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
  vocalVolume,
  microphoneVolume,
  microphoneEffects,
  startMelodyGuide,
  silenceMelodyGuide,
  sendYouTubeCommand,
  syncSecondaryMedia,
  setCurrentTime,
  setIsPlaying,
  setRecordingError,
  setRecordingSessionId,
  setAnalysisRecordingId
}) {
  const operationRef = useRef(Symbol("initial"));
  const pauseSupersededSessionRef = useRef();
  const recordingSessionRef = useRef(recordingSessionId);
  const recordingStartPromiseRef = useRef(null);
  const beginOperation = (pauseSupersededSession) => {
    const operation = Symbol(); // eslint-disable-line symbol-description
    operationRef.current = operation;
    pauseSupersededSessionRef.current = pauseSupersededSession;
    return operation;
  };
  useEffect(() => {
    beginOperation(false);
    recordingStartPromiseRef.current = null;
    return () => {
      const sessionId = recordingSessionRef.current;
      recordingSessionRef.current = null;
      if (!sessionId) return;

      // A route/song change must never leave a backend recording session alive.
      // Try to finish it; if the backend cannot save it, at least pause it.
      api
        .stopRecording(sessionId)
        .catch(() => api.pauseRecording(sessionId).catch(() => {}));
    };
  }, [song?.id]);
  useEffect(() => {
    recordingSessionRef.current = recordingSessionId;
  }, [recordingSessionId]);
  const settleSupersededRecording = async (sessionId) => {
    if (!sessionId) return;
    if (pauseSupersededSessionRef.current) {
      await api.pauseRecording(sessionId).catch(() => {});
      return;
    }
    await api
      .stopRecording(sessionId)
      .catch(() => api.pauseRecording(sessionId).catch(() => {}));
    if (recordingSessionRef.current === sessionId) {
      recordingSessionRef.current = null;
      setRecordingSessionId(null);
    }
  };
  const broadcastCommand = (action, position) => {
    if (!onlineRoom?.room) return;
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
    if (!instr || !song?.id || recordingSessionRef.current) return true;
    const operationId = operationRef.current;

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
      if (!sessionId) throw new Error(translateSaved(MISSING_RECORDING_ID));
      try {
        await api.pauseRecording(sessionId);
      } catch (pauseError) {
        await api.stopRecording(sessionId).catch(() => {});
        throw pauseError;
      }
      if (operationId !== operationRef.current) {
        await settleSupersededRecording(sessionId);
        return false;
      }
      recordingSessionRef.current = sessionId;
      setRecordingSessionId(sessionId);
      setRecordingError(null);
      return true;
    } catch (error) {
      setRecordingError(
        formatError("Не удалось подготовить запись: {0}", error)
      );
      return false;
    }
  };
  const togglePlay = async ({ broadcast = true, forcePlaying = null } = {}) => {
    const instr = instrumentalRef.current;
    const voc = vocalsRef.current;
    if (!instr || !song?.id) return undefined;
    const shouldPlay = forcePlaying == null ? !isPlaying : forcePlaying;
    const operationId = beginOperation(!shouldPlay);
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
    const melodyStart = Promise.resolve()
      .then(startMelodyGuide)
      .catch(() => {});
    let activeRecordingId = recordingSessionRef.current;
    let recordingResume = Promise.resolve();
    try {
      if (activeRecordingId) {
        const resumedSessionId = activeRecordingId;
        recordingResume = api
          .resumeRecording(resumedSessionId)
          .catch(async (error) => {
            setRecordingError(
              formatError(
                "Не удалось возобновить запись, караоке продолжит работу без неё: {0}",
                error
              )
            );
            await api.stopRecording(resumedSessionId).catch(() => {});
            if (recordingSessionRef.current === resumedSessionId) {
              recordingSessionRef.current = null;
              setRecordingSessionId(null);
            }
            activeRecordingId = null;
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
        activeRecordingId = session?.recording_session_id;
        if (!activeRecordingId) {
          throw new Error(translateSaved(MISSING_RECORDING_ID));
        }
        recordingSessionRef.current = activeRecordingId;
        setRecordingSessionId(activeRecordingId);
      }
      setRecordingError(null);
    } catch (error) {
      // Recording is an optional companion feature. A microphone/backend
      // failure must never prevent the actual karaoke playback from starting.
      activeRecordingId = null;
      recordingSessionRef.current = null;
      setRecordingSessionId(null);
      setRecordingError(
        formatError(
          "Запись недоступна, караоке продолжит работу без неё: {0}",
          error
        )
      );
    }
    if (operationId !== operationRef.current) {
      await settleSupersededRecording(activeRecordingId);
      silenceMelodyGuide();
      return false;
    }
    syncSecondaryMedia(instr.currentTime, true);
    instr.volume = playbackGain(musicVolume);
    if (voc) voc.volume = playbackGain(vocalVolume);
    sendYouTubeCommand("playVideo");
    try {
      // Start the master and secondary HTML media in the same task. Waiting for
      // instrumental.play() before calling vocals.play() creates an avoidable
      // start offset on some Chromium/audio-driver combinations.
      const instrumentalPlay = Promise.resolve().then(() => instr.play());
      // Removing this filter only adds already-settled null placeholders to
      // Promise.allSettled and cannot change playback behavior.
      // Stryker disable next-line MethodExpression
      const secondaryStarts = [
        voc ? Promise.resolve().then(() => voc.play()) : null,
        videoRef.current
          ? Promise.resolve().then(() => videoRef.current.play())
          : null,
        melodyStart,
        recordingResume
      ].filter(Boolean);
      const [instrumentalResult] = await Promise.all([
        Promise.allSettled([instrumentalPlay]),
        Promise.allSettled(secondaryStarts)
      ]);
      if (instrumentalResult[0].status === "rejected") {
        throw instrumentalResult[0].reason;
      }

      // play() promises can settle on slightly different frames. Re-anchor all
      // secondary media to the actual master clock immediately after startup.
      syncSecondaryMedia(instr.currentTime, true);
    } catch {
      pausePlaybackResources();
      if (activeRecordingId) {
        await api.pauseRecording(activeRecordingId).catch(() => {});
      }
      setIsPlaying(false);
      setRecordingError(translateSaved("Не удалось запустить воспроизведение"));
      return false;
    }
    if (operationId !== operationRef.current) {
      pausePlaybackResources();
      await settleSupersededRecording(activeRecordingId);
      return false;
    }
    setIsPlaying(true);
    if (broadcast) broadcastCommand("play", instr.currentTime);
    return true;
  };
  const stop = async ({ broadcast = true } = {}) => {
    const instr = instrumentalRef.current;
    if (!instr || !song?.id) return undefined;
    beginOperation(false);
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
          formatError("Не удалось сохранить запись: {0}", error)
        );
      } finally {
        recordingSessionRef.current = null;
        setRecordingSessionId(null);
      }
    }

    // Monitoring belongs to the explicit "Слышу себя" switch and survives
    // Stop/Pause. Recording is stopped independently above.
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
    await stop({
      broadcast: false
    });
    if (onlineRoom?.room)
      onlineRoom.syncCommand({
        type: "open-library"
      });
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
      seekToRef.current(position, {
        broadcast: false
      });
    }
    const roomActions = {
      play: () =>
        togglePlayRef.current({
          broadcast: false,
          forcePlaying: true
        }),
      pause: () =>
        togglePlayRef.current({
          broadcast: false,
          forcePlaying: false
        }),
      stop: () =>
        stopRef.current({
          broadcast: false
        })
    };
    Promise.resolve(roomActions[roomCommand.action]?.()).catch((error) => {
      setRecordingError(
        formatError("Не удалось выполнить команду комнаты: {0}", error)
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
  return {
    preparePlayback,
    returnToLibrary,
    seekTo,
    skip,
    stop,
    togglePlay
  };
}
