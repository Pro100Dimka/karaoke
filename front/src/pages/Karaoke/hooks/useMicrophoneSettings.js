import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../api/client";
import useAsyncQueue from "../../../hooks/useAsyncQueue";
import useMountedRef from "../../../hooks/useMountedRef";
import { usePolling } from "../../../hooks/usePolling";
import { translateSaved as t } from "../../../i18n/runtime";
import { getAudioPreferences } from "../../../utils/audio-preferences";
import { AUDIO_SETTINGS_CHANGED_EVENT } from "../../../utils/audioSettingsEvents";
import { getErrorMessage } from "../../../utils/errors";
import { normalizeAudioEffects, normalizeAudioRuntimeSettings } from "../utils/audio-settings";

const EFFECT_KEYS = ["reverb", "echo", "delay", "noise_suppression", "octave"];
const DEFAULT_EFFECTS = normalizeAudioEffects({});
const DEFAULT_RUNTIME = {
  volume: 1,
  audioDriver: "auto",
  outputDeviceId: "",
  monitoringEnabled: false
};
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export default function useMicrophoneSettings({ audioSettings, onError }) {
  const [runtime, setRuntime] = useState(DEFAULT_RUNTIME);
  const [microphoneEffects, setMicrophoneEffects] = useState(DEFAULT_EFFECTS);
  const [monitorInputDeviceId, setMonitorInputDeviceId] = useState(
    () => getAudioPreferences().monitorInputDeviceId || "default"
  );
  const confirmedEffects = useRef(DEFAULT_EFFECTS);
  const effectSequence = useRef(0);
  const pendingEffects = useRef(0);
  const reportedMonitorError = useRef(null);
  const mounted = useMountedRef();
  const { run: enqueue } = useAsyncQueue();

  const directMonitor = usePolling(
    () => (runtime.monitoringEnabled ? api.getDirectMonitorStatus() : Promise.resolve(null)),
    runtime.monitoringEnabled ? 1000 : 0,
    [runtime.monitoringEnabled]
  );

  const reportError = useCallback(
    (error) =>
      onError?.(
        t("karaoke.failedToSaveMicrophoneSettings", {
          0: getErrorMessage(error, t("room.transfer.unknownError"))
        })
      ),
    [onError]
  );

  const applyRuntime = useCallback((settings, partial = false) => {
    if (!settings) return;
    const next = normalizeAudioRuntimeSettings(settings);

    setRuntime((current) =>
      partial
        ? {
            volume: has(settings, "volume") ? next.volume : current.volume,
            audioDriver: has(settings, "audio_driver") ? next.audioDriver : current.audioDriver,
            outputDeviceId: has(settings, "output_device_id")
              ? next.outputDeviceId
              : current.outputDeviceId,
            monitoringEnabled: has(settings, "monitoring_enabled")
              ? next.monitoringEnabled
              : current.monitoringEnabled
          }
        : {
            volume: next.volume,
            audioDriver: next.audioDriver,
            outputDeviceId: next.outputDeviceId,
            monitoringEnabled: next.monitoringEnabled
          }
    );
  }, []);

  useEffect(() => {
    const status = directMonitor.data;
    if (status?.state !== "error") return;

    const key = status.request_id ?? status.error;
    if (reportedMonitorError.current === key) return;
    reportedMonitorError.current = key;
    onError?.(t("karaoke.couldNotEnableMonitoring", { 0: status.error }));
  }, [directMonitor.data, onError]);

  useEffect(() => {
    const sync = (event) => {
      const next = event.detail || getAudioPreferences();
      setMonitorInputDeviceId(next.monitorInputDeviceId || "default");
    };
    globalThis.addEventListener?.("audio-preferences-changed", sync);
    return () => globalThis.removeEventListener?.("audio-preferences-changed", sync);
  }, []);

  useEffect(() => {
    const sync = (event) => {
      const detail = event.detail;
      if (!detail) return;

      applyRuntime(detail, true);
      if (!EFFECT_KEYS.some((key) => has(detail, key))) return;

      const effects = normalizeAudioEffects({ ...confirmedEffects.current, ...detail });
      confirmedEffects.current = effects;
      const sequence = Number(detail.__microphoneEffectSequence) || 0;
      if (!sequence || sequence === effectSequence.current) setMicrophoneEffects(effects);
    };

    globalThis.addEventListener?.(AUDIO_SETTINGS_CHANGED_EVENT, sync);
    return () => globalThis.removeEventListener?.(AUDIO_SETTINGS_CHANGED_EVENT, sync);
  }, [applyRuntime]);

  useEffect(() => {
    if (!audioSettings) return;
    applyRuntime(audioSettings);

    if (!pendingEffects.current) {
      const effects = normalizeAudioEffects(audioSettings);
      confirmedEffects.current = effects;
      setMicrophoneEffects(effects);
    }
  }, [applyRuntime, audioSettings]);

  const updateMicrophone = useCallback(
    (patch) =>
      enqueue(async () => {
        try {
          const updated = await api.updateAudioSettings(patch);
          globalThis.dispatchEvent?.(
            new CustomEvent(AUDIO_SETTINGS_CHANGED_EVENT, { detail: updated })
          );
          return updated;
        } catch (error) {
          if (mounted.current) reportError(error);
          return null;
        }
      }),
    [enqueue, mounted, reportError]
  );

  const setMicrophoneVolume = useCallback(
    (volume) => setRuntime((state) => ({ ...state, volume })),
    []
  );
  const setDirectOutputDeviceId = useCallback(
    (outputDeviceId) => setRuntime((state) => ({ ...state, outputDeviceId })),
    []
  );
  const setMonitoringEnabled = useCallback(
    (monitoringEnabled) =>
      setRuntime((state) => ({ ...state, monitoringEnabled: !!monitoringEnabled })),
    []
  );

  const updateMicrophoneEffects = useCallback(
    (patch) => {
      const sequence = ++effectSequence.current;
      pendingEffects.current += 1;
      setMicrophoneEffects((effects) => normalizeAudioEffects({ ...effects, ...patch }));

      return enqueue(async () => {
        try {
          const updated = await api.updateAudioSettings(patch);
          const effects = normalizeAudioEffects({ ...confirmedEffects.current, ...updated });
          confirmedEffects.current = effects;
          globalThis.dispatchEvent?.(
            new CustomEvent(AUDIO_SETTINGS_CHANGED_EVENT, {
              detail: { ...updated, __microphoneEffectSequence: sequence }
            })
          );
          return updated;
        } catch (error) {
          if (mounted.current && sequence === effectSequence.current) {
            setMicrophoneEffects(confirmedEffects.current);
          }
          if (mounted.current) reportError(error);
          return null;
        } finally {
          pendingEffects.current = Math.max(0, pendingEffects.current - 1);
        }
      });
    },
    [enqueue, mounted, reportError]
  );

  return {
    microphoneVolume: runtime.volume,
    setMicrophoneVolume,
    microphoneEffects,
    setMicrophoneEffects,
    audioDriver: runtime.audioDriver,
    directOutputDeviceId: runtime.outputDeviceId,
    setDirectOutputDeviceId,
    monitoringEnabled: runtime.monitoringEnabled,
    setMonitoringEnabled,
    monitorInputDeviceId,
    updateMicrophone,
    updateMicrophoneEffects
  };
}
