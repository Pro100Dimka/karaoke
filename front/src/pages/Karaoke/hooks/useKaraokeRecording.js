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
  microphoneVolume,
  microphoneEffects,
  recordingSessionId,
  setRecordingSessionId,
  setRecordingError,
  setAnalysisRecordingId,
  operationRef,
  roomCaptureRef
}) {
  const sessionRef = useRef(recordingSessionId);
  const pendingRecordingStartRef = useRef(null);
  const beginOperation = useCallback(
    () => (operationRef.current = Symbol("karaoke-operation")),
    [operationRef]
  );
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
      const roomCapture = roomCaptureRef.current;
      roomCaptureRef.current = null;
      roomCapture?.stop?.().catch?.(() => {});
      const pendingStart = pendingRecordingStartRef.current;
      if (pendingStart && pendingStart.songId === song?.id) pendingStart.settle = "stop";
      const id = sessionRef.current;
      sessionRef.current = null;
      if (id) {
        setRecordingSessionId(null);
        finalizeRecording(id);
      }
    };
  }, [beginOperation, roomCaptureRef, setAnalysisRecordingId, setRecordingSessionId, song?.id]);

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
        microphoneEffects.octave
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
        formatError("karaoke.recordingIsNotAvailableKaraokeWillContinueToWork", error)
      );
      return null;
    }
  };

  return { sessionRef, pendingRecordingStartRef, clearSession, discardSession, runRecording };
}
