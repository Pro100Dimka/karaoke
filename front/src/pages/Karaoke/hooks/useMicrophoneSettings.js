import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../api/client";
import useAsyncQueue from "../../../hooks/useAsyncQueue";
import useMountedRef from "../../../hooks/useMountedRef";
import { getAudioPreferences } from "../../../utils/audio-preferences";
import { getErrorMessage } from "../../../utils/errors";
import {
  normalizeAudioEffects,
  normalizeAudioRuntimeSettings
} from "../utils/audio-settings";

const DEFAULT_EFFECTS = Object.freeze({ reverb: 0, echo: 0, delay: 0 });

export default function useMicrophoneSettings({ audioSettings, onError }) {
  const [microphoneVolume, setMicrophoneVolume] = useState(1);
  const [microphoneEffects, setMicrophoneEffects] = useState(DEFAULT_EFFECTS);
  const [audioDriver, setAudioDriver] = useState("auto");
  const [directOutputDeviceId, setDirectOutputDeviceId] = useState("");
  const [monitoringEnabled, setMonitoringEnabled] = useState(false);
  const [monitorInputDeviceId, setMonitorInputDeviceId] = useState(
    () => getAudioPreferences().monitorInputDeviceId
  );
  const volumeInitializedRef = useRef(false);
  const effectsInitializedRef = useRef(false);
  const mountedRef = useMountedRef();
  const { run: enqueueUpdate } = useAsyncQueue();

  useEffect(() => {
    const syncAudioPreferences = (event) => {
      const next = event.detail || getAudioPreferences();
      setMonitorInputDeviceId(next.monitorInputDeviceId || "default");
    };
    window.addEventListener("audio-preferences-changed", syncAudioPreferences);
    return () =>
      window.removeEventListener("audio-preferences-changed", syncAudioPreferences);
  }, []);

  useEffect(() => {
    if (!audioSettings || volumeInitializedRef.current) return;
    volumeInitializedRef.current = true;
    setMicrophoneVolume(normalizeAudioRuntimeSettings(audioSettings).volume);
  }, [audioSettings]);

  useEffect(() => {
    if (!audioSettings || effectsInitializedRef.current) return;
    effectsInitializedRef.current = true;
    setMicrophoneEffects(normalizeAudioEffects(audioSettings));
  }, [audioSettings]);

  useEffect(() => {
    if (!audioSettings) return;
    const normalized = normalizeAudioRuntimeSettings(audioSettings);
    setAudioDriver(normalized.audioDriver);
    setMonitoringEnabled(normalized.monitoringEnabled);
    setDirectOutputDeviceId(normalized.outputDeviceId);
  }, [audioSettings]);

  const updateMicrophone = useCallback(
    (patch) =>
      enqueueUpdate(async () => {
        try {
          const updated = await api.updateAudioSettings(patch);
          if (
            mountedRef.current &&
            Object.hasOwn(patch, "volume") &&
            updated?.volume != null
          ) {
            setMicrophoneVolume(updated.volume);
          }
          return updated;
        } catch (error) {
          if (mountedRef.current) {
            onError(
              `Не удалось сохранить настройки микрофона: ${getErrorMessage(error, "неизвестная ошибка")}`
            );
          }
          return null;
        }
      }),
    [enqueueUpdate, mountedRef, onError]
  );

  return {
    microphoneVolume,
    setMicrophoneVolume,
    microphoneEffects,
    setMicrophoneEffects,
    audioDriver,
    directOutputDeviceId,
    setDirectOutputDeviceId,
    monitoringEnabled,
    setMonitoringEnabled,
    monitorInputDeviceId,
    updateMicrophone
  };
}
