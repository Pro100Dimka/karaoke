import { useEffect, useRef } from "react";
import { api } from "../../../api/client";
import useLatestRef from "../../../hooks/useLatestRef";
import { translateSaved } from "../../../i18n/runtime";
import { getErrorMessage } from "../../../utils/errors";
import { readJsonStorage, writeJsonStorage } from "../../../utils/storage";
import { playbackGain } from "../utils/data";
import { clampPlaybackPosition, createPlayerSyncCommand } from "../utils/transport";

const UNKNOWN_ERROR = "неизвестная ошибка";
const MISSING_RECORDING_ID = "Backend не вернул идентификатор записи";
const PENDING_RECORDING_KEY = "karaoke-pending-recording-session";
const finalizingRecordings = new Map();
const pendingRecordingIds = () => {
  const value = readJsonStorage(PENDING_RECORDING_KEY, {});
  return [...new Set([...(Array.isArray(value.ids) ? value.ids : []), value.id].filter(Boolean))];
};
const writePending = (ids) =>
  writeJsonStorage(
    PENDING_RECORDING_KEY,
    ids.length > 1 ? { id: ids[0], ids } : ids.length ? { id: ids[0] } : {}
  );
const rememberPending = (id) => writePending([...new Set([...pendingRecordingIds(), id])]);
const forgetPending = (id) => writePending(pendingRecordingIds().filter((value) => value !== id));
function finalizeRecording(id) {
  if (finalizingRecordings.has(id)) return finalizingRecordings.get(id);
  const pending = (async () => {
    try {
      const recording = await api.stopRecording(id);
      forgetPending(id);
      return { recording };
    } catch (error) {
      rememberPending(id);
      await api.pauseRecording(id).catch(() => {});
      return { error };
    } finally {
      finalizingRecordings.delete(id);
    }
  })();
  finalizingRecordings.set(id, pending);
  return pending;
}
const formatError = (message, error) =>
  translateSaved(message, { 0: getErrorMessage(error, translateSaved(UNKNOWN_ERROR)) });

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
  const operationRef = useRef(Symbol("karaoke-operation"));
  const sessionRef = useRef(recordingSessionId);
  const pendingRecordingStartRef = useRef(null);
  const stopVersionRef = useRef(0);

  const beginOperation = () => (operationRef.current = Symbol("karaoke-operation"));

  useEffect(() => {
    sessionRef.current = recordingSessionId;
  }, [recordingSessionId]);

  useEffect(() => {
    beginOperation();
    pendingRecordingIds().forEach((id) => {
      finalizeRecording(id).then(({ recording }) => {
        if (recording?.id) setAnalysisRecordingId(recording.id);
      });
    });
    return () => {
      beginOperation();
      const pendingStart = pendingRecordingStartRef.current;
      if (pendingStart && pendingStart.songId === song?.id) pendingStart.settle = "stop";
      const id = sessionRef.current;
      sessionRef.current = null;
      if (id) {
        setRecordingSessionId(null);
        finalizeRecording(id);
      }
    };
  }, [setAnalysisRecordingId, setRecordingSessionId, song?.id]);

  const clearSession = (id) => {
    if (sessionRef.current !== id) return;
    sessionRef.current = null;
    forgetPending(id);
    setRecordingSessionId(null);
  };

  const discardSession = async (id) => {
    if (!id) return;
    const { error } = await finalizeRecording(id);
    if (!error) clearSession(id);
  };

  const broadcast = (action, position) => {
    if (onlineRoom?.room)
      onlineRoom.syncCommand(createPlayerSyncCommand(action, song.id, position));
  };

  useEffect(() => {
    if (!onlineRoom?.room?.host || !isPlaying || !song?.id) return undefined;
    const timer = globalThis.setInterval(() => {
      const position = instrumentalRef.current?.currentTime;
      if (Number.isFinite(position))
        onlineRoom.syncCommand(createPlayerSyncCommand("sync", song.id, position));
    }, 1000);
    return () => globalThis.clearInterval(timer);
  }, [instrumentalRef, isPlaying, onlineRoom?.room?.host, song?.id]);

  const pauseMedia = () => {
    instrumentalRef.current?.pause();
    vocalsRef.current?.pause();
    videoRef.current?.pause();
    sendYouTubeCommand("pauseVideo");
    silenceMelodyGuide();
  };

  const startRecording = async () => {
    const { recording_session_id: id } =
      (await api.startRecording(
        song.id,
        instrumentalRef.current.currentTime,
        playbackGain(musicVolume),
        microphoneVolume,
        microphoneEffects.reverb,
        microphoneEffects.echo,
        microphoneEffects.delay
      )) || {};
    if (!id) throw new Error(translateSaved(MISSING_RECORDING_ID));
    rememberPending(id);
    return id;
  };

  const getPendingRecordingStart = (operation) => {
    const { current } = pendingRecordingStartRef;
    if (current?.songId === song.id) {
      current.latestOperation = operation;
      current.settle = null;
      return current;
    }
    const entry = {
      songId: song.id,
      latestOperation: operation,
      settle: null,
      promise: null
    };
    entry.promise = startRecording().finally(() => {
      if (pendingRecordingStartRef.current === entry) pendingRecordingStartRef.current = null;
    });
    pendingRecordingStartRef.current = entry;
    return entry;
  };

  const runRecording = async (operation) => {
    let id = sessionRef.current;
    let pendingStart = null;
    try {
      if (id) {
        rememberPending(id);
        await api.resumeRecording(id);
      } else {
        pendingStart = getPendingRecordingStart(operation);
        id = await pendingStart.promise;
      }
      if (operation !== operationRef.current) {
        if (pendingStart && pendingStart.latestOperation !== operation) return;
        if (pendingStart?.settle === "pause") {
          await api.pauseRecording(id).catch(() => {});
          sessionRef.current = id;
          setRecordingSessionId(id);
          return;
        }
        await discardSession(id);
        if (pendingStart?.settle === "stop") setRecordingSessionId(null);
        return;
      }
      sessionRef.current = id;
      setRecordingSessionId(id);
      setRecordingError(null);
    } catch (error) {
      if (operation !== operationRef.current) return;
      if (id) {
        const { error: finalizeError } = await finalizeRecording(id);
        if (!finalizeError) clearSession(id);
      }
      setRecordingError(
        formatError("Запись недоступна, караоке продолжит работу без неё: {0}", error)
      );
    }
  };

  const togglePlay = async ({ broadcast: shouldBroadcast = true, forcePlaying = null } = {}) => {
    const instrumental = instrumentalRef.current;
    const vocals = vocalsRef.current;
    if (!instrumental || !song?.id) return undefined;
    const shouldPlay = forcePlaying ?? !isPlaying;
    const operation = beginOperation();
    const stopVersion = stopVersionRef.current;

    if (!shouldPlay) {
      const pendingStart = pendingRecordingStartRef.current;
      if (!sessionRef.current && pendingStart && pendingStart.songId === song.id)
        pendingStart.settle = "pause";
      pauseMedia();
      setIsPlaying(false);
      if (sessionRef.current) await api.pauseRecording(sessionRef.current).catch(() => {});
      if (shouldBroadcast) broadcast("pause", instrumental.currentTime);
      return true;
    }

    const melodyStart = Promise.resolve()
      .then(startMelodyGuide)
      .catch(() => {});
    syncSecondaryMedia(instrumental.currentTime, true);
    instrumental.volume = playbackGain(musicVolume);
    if (vocals) vocals.volume = playbackGain(vocalVolume);
    sendYouTubeCommand("playVideo");

    runRecording(operation);
    try {
      const master = Promise.resolve(instrumental.play());
      const secondary = [
        vocals && Promise.resolve(vocals.play()),
        videoRef.current && Promise.resolve(videoRef.current.play()),
        melodyStart
      ].filter(Boolean);
      const [[masterResult]] = await Promise.all([
        Promise.allSettled([master]),
        Promise.allSettled(secondary)
      ]);
      if (masterResult.status === "rejected") throw masterResult.reason;
      syncSecondaryMedia(instrumental.currentTime, true);
    } catch {
      beginOperation();
      const pendingStart = pendingRecordingStartRef.current;
      if (pendingStart && pendingStart.songId === song.id) pendingStart.settle = "stop";
      pauseMedia();
      const activeSession = sessionRef.current;
      if (activeSession) await discardSession(activeSession);
      setIsPlaying(false);
      setRecordingError(translateSaved("Не удалось запустить воспроизведение"));
      return false;
    }

    if (operation !== operationRef.current) {
      pauseMedia();
      return stopVersionRef.current === stopVersion;
    }
    setIsPlaying(true);
    if (shouldBroadcast) broadcast("play", instrumental.currentTime);
    return true;
  };

  const stop = async ({ broadcast: shouldBroadcast = true } = {}) => {
    const instrumental = instrumentalRef.current;
    if (!instrumental || !song?.id) return undefined;
    stopVersionRef.current += 1;
    beginOperation();
    const pendingStart = pendingRecordingStartRef.current;
    if (!sessionRef.current && pendingStart && pendingStart.songId === song.id)
      pendingStart.settle = "stop";
    pauseMedia();
    instrumental.currentTime = 0;
    syncSecondaryMedia(0, true);
    setIsPlaying(false);
    setCurrentTime(0);
    if (shouldBroadcast) broadcast("stop", 0);

    const id = sessionRef.current;
    if (id) {
      const { recording, error } = await finalizeRecording(id);
      if (error) {
        setRecordingError(formatError("Не удалось сохранить запись: {0}", error));
        return false;
      }
      if (recording?.id) setAnalysisRecordingId(recording.id);
      clearSession(id);
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
    if (shouldBroadcast) broadcast("seek", position);
  };

  const skip = (delta) => seekTo(clampPlaybackPosition(currentTime + delta, duration));
  const returnToLibrary = async () => {
    if (!(await stop({ broadcast: false }))) return false;
    if (onlineRoom?.room) onlineRoom.syncCommand({ type: "open-library" });
    navigate("/");
    return true;
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
    )
      return;

    const position = Number(roomCommand.position);
    if (Number.isFinite(position)) seekToRef.current(position, { broadcast: false });
    const actions = {
      play: () => togglePlayRef.current({ broadcast: false, forcePlaying: true }),
      pause: () => togglePlayRef.current({ broadcast: false, forcePlaying: false }),
      stop: () => stopRef.current({ broadcast: false })
    };
    const action = Object.hasOwn(actions, roomCommand.action) && actions[roomCommand.action];
    Promise.resolve(action && action()).catch((error) =>
      setRecordingError(formatError("Не удалось выполнить команду комнаты: {0}", error))
    );
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
