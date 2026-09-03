import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../api/client";
import useAsyncQueue from "../../../hooks/useAsyncQueue";
import useMountedRef from "../../../hooks/useMountedRef";
import { usePolling } from "../../../hooks/usePolling";
import { translateSaved as t } from "../../../i18n/runtime";
import { queryKeys } from "../../../query-client";
import { POLLING_INTERVALS } from "../../../runtime-config";
import { AUDIO_SETTINGS_CHANGED_EVENT } from "../../../utils/audioSettingsEvents";
import { getErrorMessage } from "../../../utils/errors";
import { getMicrophoneLevel } from "../utils/transport";
import useAudioOutputRouting from "./useAudioOutputRouting";
import useKaraokeRoomEffects from "./useKaraokeRoomEffects";
import useMicrophoneSettings from "./useMicrophoneSettings";

const noop = () => {};
const safe = (task) => Promise.resolve().then(task).catch(noop);
const poll = (request, interval, queryKey) => usePolling(request, interval, [], { queryKey });
const notify = (detail) =>
  globalThis.dispatchEvent?.(new CustomEvent(AUDIO_SETTINGS_CHANGED_EVENT, { detail }));

export default function useKaraokeAudio({
  onlineRoom,
  instrumentalRef,
  vocalsRef,
  videoRef,
  effectPreset,
  setEffectPreset
}) {
  const { room, participants = [], setLocalMonitoring, syncUi } = onlineRoom;
  const mounted = useMountedRef();
  const { run: queueMonitoring } = useAsyncQueue();
  const [error, setError] = useState(null);
  const [roomMonitoring, setRoomMonitoringState] = useState(false);
  const roomMonitoringRef = useRef(false);
  const effectMutation = useRef(0);

  const { data: devices } = poll(api.listAudioOutputDevices, POLLING_INTERVALS.devices, [
    "audio-output-devices"
  ]);
  const { data: audioSettings } = poll(
    api.getAudioSettings,
    POLLING_INTERVALS.devices,
    queryKeys.audioSettings
  );
  const { data: signal } = poll(api.getSignalQuality, POLLING_INTERVALS.karaokeSignal, [
    "signal-quality"
  ]);

  const microphone = useMicrophoneSettings({ audioSettings, onError: setError });
  const {
    audioDriver,
    directOutputDeviceId,
    setDirectOutputDeviceId,
    monitoringEnabled,
    setMonitoringEnabled,
    microphoneVolume,
    microphoneEffects,
    setMicrophoneEffects,
    updateMicrophone,
    updateMicrophoneEffects
  } = microphone;
  const monitoringRef = useRef(monitoringEnabled);
  monitoringRef.current = monitoringEnabled;

  const setRoomMonitoring = useCallback(
    (value) => {
      const active = Boolean(value);
      roomMonitoringRef.current = active;
      if (mounted.current) setRoomMonitoringState(active);
      return active;
    },
    [mounted]
  );

  const setNativeMonitoring = useCallback(
    (settings) => {
      const active = Boolean(settings?.monitoring_enabled);
      monitoringRef.current = active;
      if (mounted.current) setMonitoringEnabled(active);
      notify(settings);
      return settings;
    },
    [mounted, setMonitoringEnabled]
  );

  useKaraokeRoomEffects({
    room,
    participantCount: participants.length,
    syncUi,
    volume: microphoneVolume,
    effects: microphoneEffects
  });

  useAudioOutputRouting({
    audioDriver,
    audioSettings,
    directOutputDeviceId,
    directOutputDevices: devices,
    instrumentalRef,
    vocalsRef,
    videoRef,
    setDirectOutputDeviceId,
    updateMicrophone
  });

  const releaseMonitoring = useCallback(
    () =>
      queueMonitoring(async () => {
        let failure;
        let settings = null;

        if (roomMonitoringRef.current) {
          try {
            setRoomMonitoring(await setLocalMonitoring(false));
          } catch (error) {
            failure = error;
          }
        }

        if (monitoringRef.current) {
          try {
            settings = setNativeMonitoring(await api.stopDirectMonitoring());
          } catch (error) {
            failure ??= error;
          }
        }

        if (failure) throw failure;
        return settings;
      }),
    [queueMonitoring, setLocalMonitoring, setNativeMonitoring, setRoomMonitoring]
  );

  const roomKey = room ? `${room.id ?? ""}:${room.selfId ?? ""}` : "";
  useEffect(() => {
    setRoomMonitoring(false);
    queueMonitoring(async () => {
      await safe(() => setLocalMonitoring(false));
      if (roomKey && monitoringRef.current) {
        setNativeMonitoring(await api.stopDirectMonitoring());
      }
    }).catch(noop);
  }, [queueMonitoring, roomKey, setLocalMonitoring, setNativeMonitoring, setRoomMonitoring]);

  useEffect(() => {
    const release = () => {
      if (monitoringRef.current) safe(() => api.releaseDirectMonitoring());
      safe(() => setLocalMonitoring(false));
    };
    globalThis.addEventListener?.("pagehide", release);
    return () => {
      globalThis.removeEventListener?.("pagehide", release);
      release();
    };
  }, [setLocalMonitoring]);

  const onMonitoringChange = useCallback(
    (enabled) =>
      queueMonitoring(async () => {
        try {
          if (mounted.current) setError(null);

          if (room) {
            if (monitoringRef.current) {
              setNativeMonitoring(await api.stopDirectMonitoring());
            }
            setRoomMonitoring(
              await setLocalMonitoring(Boolean(enabled), {
                volume: microphoneVolume,
                ...microphoneEffects
              })
            );
          } else {
            setNativeMonitoring(
              await (enabled ? api.startDirectMonitoring() : api.stopDirectMonitoring())
            );
          }
        } catch (cause) {
          if (mounted.current) {
            setError(
              t("karaoke.failedToChangeMicrophoneListening", { 0: getErrorMessage(cause) })
            );
          }
        }
      }),
    [
      microphoneEffects,
      microphoneVolume,
      mounted,
      queueMonitoring,
      room,
      setLocalMonitoring,
      setNativeMonitoring,
      setRoomMonitoring
    ]
  );

  const saveEffects = useCallback(
    async (preset, patch) => {
      const previous = effectPreset;
      const sequence = ++effectMutation.current;
      setEffectPreset(preset);

      if ((await updateMicrophoneEffects(patch)) === null && sequence === effectMutation.current) {
        setEffectPreset(previous);
      }
    },
    [effectPreset, setEffectPreset, updateMicrophoneEffects]
  );

  const onEffectChange = useCallback(
    (key, value) => setMicrophoneEffects((effects) => ({ ...effects, [key]: value })),
    [setMicrophoneEffects]
  );
  const onEffectCommit = useCallback(
    (key, value) => saveEffects("custom", { [key]: value }),
    [saveEffects]
  );
  const onApplyEffectPreset = useCallback(
    ({ id, echo, reverb, delay }) => saveEffects(id, { echo, reverb, delay }),
    [saveEffects]
  );

  return {
    ...microphone,
    error,
    microphoneLevel: getMicrophoneLevel(signal),
    monitoringEnabled: room ? roomMonitoring : monitoringEnabled,
    releaseMonitoring,
    onMonitoringChange,
    onEffectChange,
    onEffectCommit,
    onApplyEffectPreset
  };
}
