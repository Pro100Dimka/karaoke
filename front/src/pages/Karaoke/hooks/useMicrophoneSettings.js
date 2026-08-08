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
      window.removeEventListener(
        "audio-preferences-changed",
        syncAudioPreferences
      );
  }, []);

  useEffect(() => {
    if (!audioSettings) return;
    const nextVolume = normalizeAudioRuntimeSettings(audioSettings).volume;
    setMicrophoneVolume((current) =>
      Math.abs(current - nextVolume) < 0.0001 ? current : nextVolume
    );
  }, [audioSettings]);

  useEffect(() => {
    const syncAudioSettings = (event) => {
      if (!event.detail) return;
      const normalized = normalizeAudioRuntimeSettings(event.detail);
      setMicrophoneVolume(normalized.volume);
      setAudioDriver(normalized.audioDriver);
      setMonitoringEnabled(normalized.monitoringEnabled);
      setDirectOutputDeviceId(normalized.outputDeviceId);
    };

    globalThis.addEventListener?.("audio-settings-changed", syncAudioSettings);
    return () =>
      globalThis.removeEventListener?.(
        "audio-settings-changed",
        syncAudioSettings
      );
  }, []);

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
          try {
            globalThis.dispatchEvent?.(
              new CustomEvent("audio-settings-changed", { detail: updated })
            );
          } catch {
            // CustomEvent is unavailable in a few non-browser test runtimes.
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
