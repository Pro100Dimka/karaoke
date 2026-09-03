import { useCallback, useEffect, useRef } from "react";
import { api } from "../../../api/client";
import { translateSaved } from "../../../i18n/runtime";
import { playbackGain } from "../utils/data";
import {
  pendingRecordingIds,
  finalizeRecording,
  rememberPending,
  forgetPending,
  formatError
} from "../utils/recordingSession";

const MISSING_RECORDING_ID = "karaoke.backendDidNotReturnPostId";
export default function useKaraokeRecording({
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
}) {
  const sessionRef = useRef(recordingSessionId);
  const pendingRecordingStartRef = useRef(null);
  const previousSpeedRef = useRef(speed);
  // Pause/resume for one session must apply on the backend in the order the
  // user actually pressed them, not in whichever order the two network
  // responses happen to land -- otherwise a fast pause-then-resume can have
  // resume apply first, leaving the backend paused while the UI reports
  // "recording" for the rest of the take.
  const recordingRequestQueueRef = useRef(Promise.resolve());
  const recordingControlsQueueRef = useRef(Promise.resolve());
  const recordingControlsPendingRef = useRef(0);
  const queueRecordingRequest = useCallback((task) => {
    const next = recordingRequestQueueRef.current.then(task, task);
    recordingRequestQueueRef.current = next.catch(() => {});
    return next;
  }, []);
  const queueRecordingControls = useCallback((task) => {
    recordingControlsPendingRef.current += 1;
    const next = recordingControlsQueueRef.current.then(task, task).finally(() => {
      recordingControlsPendingRef.current -= 1;
    });
    recordingControlsQueueRef.current = next.catch(() => {});
    return next;
  }, []);
  const flushRecordingControls = useCallback(
    () => recordingControlsQueueRef.current.catch(() => {}),
    []
  );
  const finalizeAfterControls = useCallback(
    (id) =>
      recordingControlsPendingRef.current
        ? flushRecordingControls().then(() => finalizeRecording(id))
        : finalizeRecording(id),
    [flushRecordingControls]
  );
  useEffect(() => {
    sessionRef.current = recordingSessionId;
  }, [recordingSessionId]);

  useEffect(() => {
    const previous = previousSpeedRef.current;
    previousSpeedRef.current = speed;
    const instrumental = instrumentalRef.current;
    if (previous === speed || !recordingSessionId || !instrumental) return;
    Promise.resolve(api.syncRecording(recordingSessionId, instrumental.currentTime, speed)).catch(
      () => {}
    );
  }, [instrumentalRef, recordingSessionId, speed]);

  useEffect(() => {
    if (!recordingSessionId) return undefined;
    let current = true;
    queueRecordingControls(() =>
      api.updateRecordingControls(recordingSessionId, {
        musicVolume: playbackGain(musicVolume),
        microphoneVolume,
        reverb: microphoneEffects.reverb,
        echo: microphoneEffects.echo,
        delay: microphoneEffects.delay,
        octave: microphoneEffects.octave ?? 0
      })
    ).catch((error) => {
      if (current && sessionRef.current === recordingSessionId) {
        setRecordingError(formatError("settings.couldNotSaveAudioSettings", error));
      }
    });
    return () => {
      current = false;
    };
  }, [
    microphoneEffects.delay,
    microphoneEffects.echo,
    microphoneEffects.octave,
    microphoneEffects.reverb,
    microphoneVolume,
    musicVolume,
    queueRecordingControls,
    recordingSessionId,
    setRecordingError
  ]);

  useEffect(() => {
    beginOperation();
    pendingRecordingIds().forEach((id) => {
      finalizeRecording(id).then(({ recording }) => {
        if (recording?.id) setAnalysisRecordingId(recording.id);
      });
    });
    return () => {
      beginOperation();
      const roomCapture = roomCaptureRef.current;
      roomCaptureRef.current = null;
      roomCapture?.stop?.().catch?.(() => {});
      const pendingStart = pendingRecordingStartRef.current;
      if (pendingStart && pendingStart.songId === song?.id) pendingStart.settle = "stop";
      const id = sessionRef.current;
      sessionRef.current = null;
      if (id) {
        setRecordingSessionId(null);
        finalizeAfterControls(id);
      }
    };
  }, [
    beginOperation,
    finalizeAfterControls,
    roomCaptureRef,
    setAnalysisRecordingId,
    setRecordingSessionId,
    song?.id
  ]);

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

  const pauseRecording = (id) => queueRecordingRequest(() => api.pauseRecording(id));

  const startRecording = async () => {
    const { recording_session_id: id } =
      (await api.startRecording(
        song.id,
        instrumentalRef.current.currentTime,
        playbackGain(musicVolume),
        microphoneVolume,
        microphoneEffects.reverb,
        microphoneEffects.echo,
        microphoneEffects.delay,
        Boolean(onlineRoom?.room),
        microphoneEffects.octave,
        speed,
        Boolean(onlineRoom?.voiceRef?.current?.usingRelay)
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
        await queueRecordingRequest(() => api.resumeRecording(id));
      } else {
        pendingStart = getPendingRecordingStart(operation);
        id = await pendingStart.promise;
      }
      if (operation !== operationRef.current) {
        if (pendingStart && pendingStart.latestOperation !== operation) return null;
        if (pendingStart?.settle === "pause") {
          await queueRecordingRequest(() => api.pauseRecording(id)).catch(() => {});
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
        formatError("karaoke.recordingIsNotAvailableKaraokeWillContinueToWork", error)
      );
      return null;
    }
  };

  return {
    sessionRef,
    pendingRecordingStartRef,
    clearSession,
    discardSession,
    runRecording,
    pauseRecording,
    flushRecordingControls
  };
}
