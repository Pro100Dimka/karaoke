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
const ROOM_PLAY_LEAD_MS = 450;
const MASTER_PLAY_TIMEOUT_MS = 4_000;
const finalizingRecordings = new Map();
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
const isMissingSession = (error) => Number(error?.status) === 404;
function finalizeRecording(id) {
  if (finalizingRecordings.has(id)) return finalizingRecordings.get(id);
  const pending = (async () => {
    try {
      const recording = await api.stopRecording(id);
      forgetPending(id);
      return { recording };
    } catch (error) {
      if (isMissingSession(error)) {
        forgetPending(id);
        return { missing: true };
      }
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
  playback,
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

  const clearSession = (id, forget = true) => {
    if (sessionRef.current !== id) return;
    sessionRef.current = null;
    if (forget) forgetPending(id);
    setRecordingSessionId(null);
  };

  const discardSession = async (id) => {
    if (!id) return;
    const { error } = await finalizeRecording(id);
    if (!error) clearSession(id);
  };

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
    }, 1000);
    return () => globalThis.clearInterval(timer);
  }, [instrumentalRef, isPlaying, onlineRoom?.room?.host, roomSyncCommand, song?.id]);

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
        if (pendingStart && pendingStart.latestOperation !== operation) return null;
        if (pendingStart?.settle === "pause") {
          await api.pauseRecording(id).catch(() => {});
          sessionRef.current = id;
          setRecordingSessionId(id);
          return null;
        }
        await discardSession(id);
        if (pendingStart?.settle === "stop") setRecordingSessionId(null);
        return null;
      }
      sessionRef.current = id;
      setRecordingSessionId(id);
      setRecordingError(null);
      return id;
    } catch (error) {
      if (operation !== operationRef.current) return null;
      if (id) {
        const { error: finalizeError } = await finalizeRecording(id);
        if (!finalizeError) clearSession(id);
      }
      setRecordingError(
        formatError("Запись недоступна, караоке продолжит работу без неё: {0}", error)
      );
      return null;
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
      lifecycle.pause();
      const pendingStart = pendingRecordingStartRef.current;
      if (!sessionRef.current && pendingStart && pendingStart.songId === song.id)
        pendingStart.settle = "pause";
      pauseMedia();
      // setCurrentTime is throttled during playback (see useKaraokeMediaSync),
      // so the last published value can be briefly behind the exact moment
      // playback actually stopped -- resync it here rather than leaving the
      // paused timecode/lyrics highlight a fraction of a second stale.
      setCurrentTime(instrumental.currentTime);
      lifecycle.paused();
      if (sessionRef.current) await api.pauseRecording(sessionRef.current).catch(() => {});
      if (shouldBroadcast) broadcast("pause", instrumental.currentTime);
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
      if (scheduledAt != null) await wait(scheduledAt - onlineRoom.roomClockNow());
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
        Promise.resolve(api.syncRecording(recordingId, instrumental.currentTime)).catch((error) => {
          if (operation === operationRef.current) {
            setRecordingError(formatError("Не удалось точно синхронизировать запись: {0}", error));
          }
        });
      });
    } catch {
      beginOperation();
      const pendingStart = pendingRecordingStartRef.current;
      if (pendingStart && pendingStart.songId === song.id) pendingStart.settle = "stop";
      pauseMedia();
      const activeSession = sessionRef.current;
      if (activeSession) await discardSession(activeSession);
      lifecycle.fail();
      setRecordingError(translateSaved("Не удалось запустить воспроизведение"));
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

  const stop = async ({ broadcast: shouldBroadcast = true } = {}) => {
    const instrumental = instrumentalRef.current;
    if (!instrumental || !song?.id) return undefined;
    lifecycle.stop();
    stopVersionRef.current += 1;
    beginOperation();
    const pendingStart = pendingRecordingStartRef.current;
    if (!sessionRef.current && pendingStart && pendingStart.songId === song.id)
      pendingStart.settle = "stop";
    pauseMedia();
    instrumental.currentTime = 0;
    syncSecondaryMedia(0, true);
    lifecycle.stopped();
    setCurrentTime(0);
    if (shouldBroadcast) broadcast("stop", 0);

    const id = sessionRef.current;
    if (id) {
      const { recording, error } = await finalizeRecording(id);
      if (error) {
        setRecordingError(formatError("Не удалось сохранить запись: {0}", error));
        clearSession(id, false);
        return true;
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
    if (isPlaying && sessionRef.current) {
      Promise.resolve(api.syncRecording(sessionRef.current, position)).catch(() => {});
    }
    if (shouldBroadcast) broadcast("seek", position);
  };

  const skip = (delta) => seekTo(clampPlaybackPosition(currentTime + delta, duration));
  const returnToLibrary = async () => {
    try {
      await stop({ broadcast: false });
    } catch (error) {
      setRecordingError(formatError("Не удалось сохранить запись: {0}", error));
    }
    if (onlineRoom?.room) {
      await Promise.resolve(onlineRoom.syncCommand({ type: "open-library" })).catch(() => {});
    }
    navigate("/");
    return true;
  };

  const togglePlayRef = useLatestRef(togglePlay);
  const seekToRef = useLatestRef(seekTo);
  const stopRef = useLatestRef(stop);
  const lastAppliedCommandIdRef = useRef(null);
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
    if (roomCommand.commandId && roomCommand.commandId === lastAppliedCommandIdRef.current) return;
    lastAppliedCommandIdRef.current = roomCommand.commandId ?? lastAppliedCommandIdRef.current;

    const position = Number(roomCommand.position);
    const sentAt = Number(roomCommand.__serverSentAt);
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
        Math.abs(instrumentalRef.current.currentTime - targetPosition) > 0.08)
    )
      seekToRef.current(targetPosition, { broadcast: false });
    const actions = {
      play: () => togglePlayRef.current({ broadcast: false, forcePlaying: true }),
      pause: () => togglePlayRef.current({ broadcast: false, forcePlaying: false }),
      stop: () => stopRef.current({ broadcast: false })
    };
    const action = Object.hasOwn(actions, roomCommand.action) && actions[roomCommand.action];
    const runAction = () =>
      Promise.resolve(action && action()).catch((error) =>
        setRecordingError(formatError("Не удалось выполнить команду комнаты: {0}", error))
      );
    const delay =
      roomCommand.action === "play" && Number.isFinite(executeAt) && Number.isFinite(serverNow)
        ? Math.max(0, executeAt - serverNow)
        : 0;
    if (!action || delay <= 0) {
      runAction();
      return undefined;
    }
    const timer = globalThis.setTimeout(runAction, delay);
    return () => globalThis.clearTimeout(timer);
  }, [
    instrumentalRef,
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
