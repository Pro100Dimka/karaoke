import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../api/client";
import useMountedRef from "../../../hooks/useMountedRef";
import { translateSaved as t } from "../../../i18n/runtime";
import { playbackGain } from "../utils/data";
import {
  finalizeRecording,
  forgetPending,
  formatError,
  pendingRecordingIds,
  rememberPending
} from "../utils/recordingSession";

const MISSING_ID = "karaoke.backendDidNotReturnPostId";
const noop = () => {};

function useQueue() {
  const queue = useRef(Promise.resolve());
  const run = useCallback((task) => {
    const next = queue.current.then(task, task);
    queue.current = next.catch(noop);
    return next;
  }, []);
  const flush = useCallback(() => queue.current.catch(noop), []);
  return [run, flush];
}

export default function useKaraokeRecording({
  song,
  onlineRoom,
  instrumentalRef,
  musicVolume,
  speed,
  microphoneVolume,
  microphoneEffects,
  setRecordingError,
  setAnalysisRecordingId,
  operationRef,
  beginOperation,
  roomCaptureRef
}) {
  const mounted = useMountedRef();
  const [recordingSessionId, setRecordingSessionId] = useState(null);
  const sessionRef = useRef(null);
  const pendingStartRef = useRef(null);
  const previousSpeed = useRef(speed);
  const [queueRequest, flushRequests] = useQueue();
  const [queueControls, flushControls] = useQueue();

  const setSession = useCallback(
    (id) => {
      sessionRef.current = id;
      if (mounted.current) setRecordingSessionId(id);
    },
    [mounted]
  );

  const syncRecording = useCallback(
    (id, position, rate) => queueRequest(() => api.syncRecording(id, position, rate)),
    [queueRequest]
  );
  const flushRecording = useCallback(
    () => Promise.all([flushRequests(), flushControls()]),
    [flushControls, flushRequests]
  );

  const clearSession = useCallback(
    (id, forget = true) => {
      if (sessionRef.current !== id) return;
      if (forget) forgetPending(id);
      setSession(null);
    },
    [setSession]
  );

  const discardSession = useCallback(
    async (id) => {
      if (!id) return;
      await flushRecording();
      const { error } = await finalizeRecording(id);
      if (!error) clearSession(id);
    },
    [clearSession, flushRecording]
  );

  useEffect(() => {
    const previous = previousSpeed.current;
    previousSpeed.current = speed;
    const audio = instrumentalRef.current;
    if (previous !== speed && recordingSessionId && audio) {
      syncRecording(recordingSessionId, audio.currentTime, speed).catch(noop);
    }
  }, [instrumentalRef, recordingSessionId, speed, syncRecording]);

  useEffect(() => {
    if (!recordingSessionId) return;
    let active = true;

    queueControls(() =>
      api.updateRecordingControls(recordingSessionId, {
        musicVolume: playbackGain(musicVolume),
        microphoneVolume,
        reverb: microphoneEffects.reverb,
        echo: microphoneEffects.echo,
        delay: microphoneEffects.delay,
        octave: microphoneEffects.octave ?? 0
      })
    ).catch((error) => {
      if (active && sessionRef.current === recordingSessionId) {
        setRecordingError(formatError("settings.couldNotSaveAudioSettings", error));
      }
    });

    return () => {
      active = false;
    };
  }, [
    microphoneEffects.delay,
    microphoneEffects.echo,
    microphoneEffects.octave,
    microphoneEffects.reverb,
    microphoneVolume,
    musicVolume,
    queueControls,
    recordingSessionId,
    setRecordingError
  ]);

  useEffect(() => {
    let active = true;
    beginOperation();

    pendingRecordingIds().forEach((id) => {
      finalizeRecording(id)
        .then(({ recording }) => {
          if (active && mounted.current && recording?.id) setAnalysisRecordingId(recording.id);
        })
        .catch(noop);
    });

    return () => {
      active = false;
      beginOperation();
      const capture = roomCaptureRef.current;
      roomCaptureRef.current = null;
      Promise.resolve().then(() => capture?.stop?.()).catch(noop);

      const pending = pendingStartRef.current;
      if (pending?.songId === song?.id) pending.settle = "stop";

      const id = sessionRef.current;
      setSession(null);
      if (!id) return;
      flushRecording().then(() => finalizeRecording(id)).catch(noop);
    };
  }, [
    beginOperation,
    flushRecording,
    mounted,
    roomCaptureRef,
    setAnalysisRecordingId,
    setSession,
    song?.id
  ]);

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

    if (!id) throw new Error(t(MISSING_ID));
    rememberPending(id);
    return id;
  };

  const getPendingStart = (operation) => {
    const current = pendingStartRef.current;
    if (current?.songId === song.id) {
      current.latestOperation = operation;
      current.settle = null;
      return current;
    }

    const pending = {
      songId: song.id,
      latestOperation: operation,
      settle: null
    };
    pending.promise = startRecording().finally(() => {
      if (pendingStartRef.current === pending) pendingStartRef.current = null;
    });
    pendingStartRef.current = pending;
    return pending;
  };

  const runRecording = async (operation) => {
    let id = sessionRef.current;
    let pending;

    try {
      if (id) {
        rememberPending(id);
        await queueRequest(() => api.resumeRecording(id));
      } else {
        pending = getPendingStart(operation);
        id = await pending.promise;
      }

      if (operation !== operationRef.current) {
        if (pending?.latestOperation !== operation && pending) return null;
        if (pending?.settle === "pause") {
          await queueRequest(() => api.pauseRecording(id)).catch(noop);
          setSession(id);
          return null;
        }
        await discardSession(id);
        if (pending?.settle === "stop") setSession(null);
        return null;
      }

      setSession(id);
      if (mounted.current) setRecordingError(null);
      return id;
    } catch (error) {
      if (operation !== operationRef.current) return null;
      if (id) await discardSession(id);
      if (mounted.current) {
        setRecordingError(
          formatError("karaoke.recordingIsNotAvailableKaraokeWillContinueToWork", error)
        );
      }
      return null;
    }
  };

  return {
    recordingSessionId,
    sessionRef,
    pendingRecordingStartRef: pendingStartRef,
    clearSession,
    discardSession,
    runRecording,
    pauseRecording: (id) => queueRequest(() => api.pauseRecording(id)),
    syncRecording,
    flushRecording
  };
}
