import { useCallback, useRef, useState } from "react";
import { api } from "../../../api/client";
import { translateSaved as t } from "../../../i18n/runtime";
import { createRoomVoiceCapture } from "../../../services/roomVoiceCapture";
import { playbackGain } from "../utils/data";
import { finalizeRecording, formatError } from "../utils/recordingSession";
import { clampPlaybackPosition } from "../utils/transport";
import useKaraokeRecording from "./useKaraokeRecording";
import useKaraokeRoomTransport from "./useKaraokeRoomTransport";
import useOperationGate from "./useOperationGate";

export { createRoomVoiceCapture } from "../../../services/roomVoiceCapture";

const ROOM_PLAY_LEAD_MS = 450;
const MASTER_PLAY_TIMEOUT_MS = 4000;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

function useEvent(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  return useCallback((...args) => ref.current(...args), []);
}

async function playMaster(media) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve(media.play()),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Master media playback timed out")),
          MASTER_PLAY_TIMEOUT_MS
        );
      })
    ]);
  } catch (error) {
    if (media.paused !== false) throw error;
  } finally {
    clearTimeout(timer);
  }
}

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
  musicVolume,
  speed,
  vocalVolume,
  microphoneVolume,
  microphoneEffects,
  startMelodyGuide,
  silenceMelodyGuide,
  syncSecondaryMedia,
  setCurrentTime,
  playback,
  releaseMonitoring
}) {
  const [recordingSessionId, setRecordingSessionId] = useState(null);
  const [analysisRecordingId, setAnalysisState] = useState(null);
  const [recordingError, setRecordingError] = useState(null);
  const analysisRecordingIdRef = useRef(null);
  const setAnalysisRecordingId = useCallback((value) => {
    setAnalysisState((previous) => {
      const next = typeof value === "function" ? value(previous) : value;
      analysisRecordingIdRef.current = next;
      return next;
    });
  }, []);
  const clearAnalysis = useCallback(() => setAnalysisRecordingId(null), [setAnalysisRecordingId]);

  const lifecycle = playback;
  const { operationRef, beginOperation, waitForOperation } = useOperationGate();
  const roomCaptureRef = useRef(null);
  const stopVersionRef = useRef(0);
  const stopInFlightRef = useRef(null);
  const {
    sessionRef,
    pendingRecordingStartRef,
    clearSession,
    discardSession,
    runRecording,
    pauseRecording,
    flushRecordingControls
  } = useKaraokeRecording({
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
    beginOperation,
    roomCaptureRef
  });

  const pauseMedia = () => {
    instrumentalRef.current?.pause();
    vocalsRef.current?.pause();
    videoRef.current?.pause();
    silenceMelodyGuide();
  };

  const startRoomCapture = async (position) => {
    if (!onlineRoom?.room) return null;

    if (roomCaptureRef.current) {
      await Promise.resolve(roomCaptureRef.current.resume?.()).catch(() => {});
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

    return Promise.resolve()
      .then(() => capture.stop())
      .then((blob) => ({ blob, startPlaybackSec: capture.startPlaybackSec }));
  };

  const togglePlay = async ({ broadcast: shouldBroadcast = true, forcePlaying = null } = {}) => {
    const instrumental = instrumentalRef.current;
    if (!instrumental || !song?.id) return false;

    const shouldPlay = forcePlaying ?? !isPlaying;
    const operation = beginOperation();
    const stopVersion = stopVersionRef.current;

    if (!shouldPlay) {
      lifecycle.pause();
      const pending = pendingRecordingStartRef.current;
      if (!sessionRef.current && pending?.songId === song.id) pending.settle = "pause";

      pauseMedia();
      await Promise.resolve(roomCaptureRef.current?.pause?.()).catch(() => {});
      setCurrentTime(instrumental.currentTime);
      lifecycle.paused();
      if (shouldBroadcast) broadcast("pause", instrumental.currentTime);
      if (sessionRef.current) await pauseRecording(sessionRef.current).catch(() => {});
      return true;
    }

    lifecycle.start();
    const scheduledAt =
      shouldBroadcast && onlineRoom?.room && typeof onlineRoom.roomClockNow === "function"
        ? onlineRoom.roomClockNow() + ROOM_PLAY_LEAD_MS
        : null;
    if (scheduledAt != null) broadcast("play", instrumental.currentTime, scheduledAt);

    const melodyStart = Promise.resolve(startMelodyGuide()).catch(() => {});
    syncSecondaryMedia(instrumental.currentTime, true);
    instrumental.volume = playbackGain(musicVolume);
    if (vocalsRef.current) vocalsRef.current.volume = playbackGain(vocalVolume);

    const recordingStart = runRecording(operation);
    try {
      await waitForOperation(recordingStart, operation);
      if (operation !== operationRef.current) {
        pauseMedia();
        return false;
      }

      if (scheduledAt != null) {
        await wait(scheduledAt - onlineRoom.roomClockNow());
        if (operation !== operationRef.current) {
          pauseMedia();
          return false;
        }
      }

      await startRoomCapture(instrumental.currentTime);
      if (operation !== operationRef.current) {
        pauseMedia();
        await stopRoomCapture().catch(() => null);
        return false;
      }

      const followers = [
        vocalsRef.current && Promise.resolve(vocalsRef.current.play()),
        videoRef.current && Promise.resolve(videoRef.current.play()),
        melodyStart
      ].filter(Boolean);
      followers.forEach((promise) => Promise.resolve(promise).catch(() => {}));
      await playMaster(instrumental);

      if (operation !== operationRef.current) {
        pauseMedia();
        await Promise.resolve(roomCaptureRef.current?.pause?.()).catch(() => {});
        return stopVersionRef.current === stopVersion;
      }

      syncSecondaryMedia(instrumental.currentTime, true);
      recordingStart.then((id) => {
        if (!id || operation !== operationRef.current) return;
        Promise.resolve(api.syncRecording(id, instrumental.currentTime, speed)).catch((error) => {
          if (operation === operationRef.current) {
            setRecordingError(formatError("karaoke.couldNotPreciselySynchronizeRecording", error));
          }
        });
      });
    } catch {
      beginOperation();
      const pending = pendingRecordingStartRef.current;
      if (pending?.songId === song.id) pending.settle = "stop";
      pauseMedia();
      await stopRoomCapture().catch(() => null);
      if (sessionRef.current) await discardSession(sessionRef.current);
      lifecycle.fail();
      setRecordingError(t("karaoke.failedToStartPlayback"));
      if (scheduledAt != null) broadcast("pause", instrumental.currentTime);
      return false;
    }

    lifecycle.played();
    if (shouldBroadcast && scheduledAt == null) broadcast("play", instrumental.currentTime);
    return true;
  };

  const runStop = async (shouldBroadcast) => {
    const instrumental = instrumentalRef.current;
    if (!instrumental || !song?.id) return false;

    lifecycle.stop();
    stopVersionRef.current += 1;
    beginOperation();

    const pending = pendingRecordingStartRef.current;
    if (!sessionRef.current && pending?.songId === song.id) pending.settle = "stop";

    pauseMedia();
    const roomAudio = stopRoomCapture().catch(() => null);
    instrumental.currentTime = 0;
    syncSecondaryMedia(0, true);
    setCurrentTime(0);
    lifecycle.stopped();
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
          const captured = await roomAudio;
          if (captured?.blob?.size) {
            try {
              const latency = await Promise.resolve(onlineRoom?.estimateRemoteVoiceLatency?.()).catch(
                () => 0
              );
              await api.attachRoomAudio(
                recording.id,
                captured.blob,
                captured.startPlaybackSec,
                latency
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
      await Promise.resolve(releaseMonitoring?.());
    } catch (error) {
      setRecordingError(formatError("karaoke.couldNotDisableMicrophoneMonitoring", error));
    }

    return true;
  };

  const stop = ({ broadcast: shouldBroadcast = true } = {}) => {
    if (stopInFlightRef.current) return stopInFlightRef.current;
    const request = runStop(shouldBroadcast).finally(() => {
      if (stopInFlightRef.current === request) stopInFlightRef.current = null;
    });
    stopInFlightRef.current = request;
    return request;
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

  const skip = (delta) =>
    seekTo(
      clampPlaybackPosition(
        (Number(instrumentalRef.current?.currentTime) || currentTime) + delta,
        duration
      )
    );

  const returnToLibrary = async ({ alreadyStopped = false, analysisId = null } = {}) => {
    if (onlineRoom?.room) {
      Promise.resolve(onlineRoom.syncCommand?.({ type: "open-library" })).catch(() => {});
    }

    if (!alreadyStopped) {
      try {
        await stop({ broadcast: false });
      } catch (error) {
        setRecordingError(formatError("karaoke.failedToSaveEntry", error));
      }
    }

    navigate(
      "/",
      alreadyStopped
        ? {
            replace: true,
            state: { fromKaraokeFade: true, analysisRecordingId: analysisId || null }
          }
        : undefined
    );
    return true;
  };

  const broadcast = useKaraokeRoomTransport({
    onlineRoom,
    songId: song?.id,
    instrumentalRef,
    isPlaying,
    navigate,
    seekTo,
    stop,
    togglePlay,
    setRecordingError
  });

  const stableReturnToLibrary = useEvent(returnToLibrary);
  const stableSeekTo = useEvent(seekTo);
  const stableSkip = useEvent(skip);
  const stableStop = useEvent(stop);
  const stableTogglePlay = useEvent(togglePlay);

  return {
    returnToLibrary: stableReturnToLibrary,
    seekTo: stableSeekTo,
    skip: stableSkip,
    stop: stableStop,
    togglePlay: stableTogglePlay,
    recordingSessionId,
    recordingError,
    analysisRecordingId,
    analysisRecordingIdRef,
    clearAnalysis
  };
}
