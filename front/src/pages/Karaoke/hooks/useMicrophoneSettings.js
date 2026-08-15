import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../api/client";
import useAsyncQueue from "../../../hooks/useAsyncQueue";
import useMountedRef from "../../../hooks/useMountedRef";
import { translateSaved } from "../../../i18n/runtime";
import { getAudioPreferences } from "../../../utils/audio-preferences";
import { getErrorMessage } from "../../../utils/errors";
import { normalizeAudioEffects, normalizeAudioRuntimeSettings } from "../utils/audio-settings";

export default function useMicrophoneSettings({ audioSettings, onError }) {
  const [microphoneVolume, setMicrophoneVolume] = useState(1);
  const [microphoneEffects, setMicrophoneEffects] = useState(() => ({ reverb: 0, echo: 0, delay: 0 }));
  const [audioDriver, setAudioDriver] = useState("auto");
  const [directOutputDeviceId, setDirectOutputDeviceId] = useState("");
  const [monitoringEnabled, setMonitoringEnabled] = useState(false);
  const [monitorInputDeviceId, setMonitorInputDeviceId] = useState(
    () => getAudioPreferences().monitorInputDeviceId
  );
  const effectsInitializedRef = useRef(false);
  const mountedRef = useMountedRef();
  const { run: enqueueUpdate } = useAsyncQueue();
  useEffect(
    () => {
      const syncAudioPreferences = (event) => {
        const next = event.detail || getAudioPreferences();
        setMonitorInputDeviceId(next.monitorInputDeviceId || "default");
      };
      window.addEventListener( "audio-preferences-changed", syncAudioPreferences
      );
      return () =>
        window.removeEventListener( "audio-preferences-changed", syncAudioPreferences
        );
    },
    // Stryker disable next-line ArrayDeclaration: globals and setter are stable.
    []
  );
  useEffect(
    () => {
      const syncAudioSettings = (event) => {
        if (!event.detail) return;
        const normalized = normalizeAudioRuntimeSettings(event.detail);
        setMicrophoneVolume(normalized.volume);
        setAudioDriver(normalized.audioDriver);
        setMonitoringEnabled(normalized.monitoringEnabled);
        setDirectOutputDeviceId(normalized.outputDeviceId);
      };
      globalThis.addEventListener("audio-settings-changed", syncAudioSettings);
      return () =>
        globalThis.removeEventListener( "audio-settings-changed", syncAudioSettings
        );
    },
    // Stryker disable next-line ArrayDeclaration: globals and setters are stable.
    []
  );
  useEffect(() => {
    if (!audioSettings) return;
    const normalized = normalizeAudioRuntimeSettings(audioSettings);
    setMicrophoneVolume(normalized.volume);
    setAudioDriver(normalized.audioDriver);
    setMonitoringEnabled(normalized.monitoringEnabled);
    setDirectOutputDeviceId(normalized.outputDeviceId);
    if (!effectsInitializedRef.current) {
      effectsInitializedRef.current = true;
      setMicrophoneEffects(normalizeAudioEffects(audioSettings));
    }
  }, [audioSettings]);
  const updateMicrophone = useCallback(
    (patch) =>
      enqueueUpdate(async () => {
        try {
          const updated = await api.updateAudioSettings(patch);
          globalThis.dispatchEvent( new CustomEvent("audio-settings-changed", { detail: updated })
          );
          return updated;
        } catch (error) {
          if (mountedRef.current) {
            onError(
              translateSaved("Не удалось сохранить настройки микрофона: {0}", {
                0: getErrorMessage(error, translateSaved("неизвестная ошибка"))
              })
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
