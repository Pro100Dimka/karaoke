/* eslint-disable no-promise-executor-return */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { POLLING_INTERVALS } from "../../runtime-config";
import { useAppDialog } from "../../contexts/AppDialog";
import useSpeakingLevels from "../../contexts/hooks/useSpeakingLevels";
import useAsyncQueue from "../../hooks/useAsyncQueue";
import useExclusiveAsyncAction from "../../hooks/useExclusiveAsyncAction";
import { usePolling } from "../../hooks/usePolling";
import { translateSaved } from "../../i18n/runtime";
import { getAudioPreferences, saveAudioPreferences } from "../../utils/audio-preferences";
import { getErrorMessage } from "../../utils/errors";
import {
  groupBrowserAudioDevices,
  normalizeAudioRuntimeSettings
} from "../Karaoke/utils/audio-settings";
import {
  createBrowserDeviceOptions,
  createBufferSizeOptions,
  createIndexedDeviceOptions
} from "../Karaoke/utils/devices";
import { EMPTY_BROWSER_DEVICES } from "./config";

export function stopStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
}

export function getSignalLevel(signal) {
  const db = Number(signal?.rms_db ?? signal?.rms_dbfs);
  return Number.isFinite(db) ? Math.max(0, Math.min(100, ((db + 60) / 60) * 100)) : 0;
}

export function resolveMonitorTarget(enabled, monitoringEnabled, localSpeakingLevel, signal) {
  return enabled && monitoringEnabled
    ? Math.max(localSpeakingLevel * 100, getSignalLevel(signal))
    : 0;
}

export function nextMonitorLevel(current, target, now, peakUntil) {
  if (target >= current) return Math.min(100, target);
  if (now < peakUntil) return current;
  const next = current * 0.78;
  // Stryker disable next-line EqualityOperator: no IEEE-754 input maps the product exactly to 0.8.
  return next < 0.8 ? 0 : next;
}

function useConditionalPolling(enabled, fetcher, interval, fallback) {
  return usePolling(
    () => (enabled ? fetcher() : Promise.resolve(fallback)),
    enabled ? interval : 0,
    [enabled, fetcher]
  );
}

export default function useAudioSettingsSource({ enabled = true } = {}) {
  const { alert } = useAppDialog();
  const { data: settings, refresh } = useConditionalPolling(
    enabled,
    api.getAudioSettings,
    POLLING_INTERVALS.settings,
    null
  );
  const { data: devices } = useConditionalPolling(
    enabled,
    api.listAudioDevices,
    POLLING_INTERVALS.devices,
    []
  );
  const { data: outputs } = useConditionalPolling(
    enabled,
    api.listAudioOutputDevices,
    POLLING_INTERVALS.devices,
    []
  );
  const { data: asioDrivers } = useConditionalPolling(
    enabled,
    api.listAsioDrivers,
    POLLING_INTERVALS.devices,
    []
  );
  const { data: signal } = useConditionalPolling(
    enabled,
    api.getSignalQuality,
    POLLING_INTERVALS.realtimeSignal,
    null
  );
  const [browserDevices, setBrowserDevices] = useState(EMPTY_BROWSER_DEVICES);
  const [preferences, setPreferences] = useState(getAudioPreferences);
  const [speakerTestState, setSpeakerTestState] = useState("idle");
  const [monitorLevel, setMonitorLevel] = useState(0);
  const monitorStream = useRef(null);
  const monitorRequest = useRef(0);
  const monitorPending = useRef(0);
  const speakerTimer = useRef(null);
  const monitorTarget = useRef(0);
  const monitorPeak = useRef(0);
  const { localSpeakingLevel, prepareSpeakingMeter, startSpeakingMeter, stopSpeakingMeter } =
    useSpeakingLevels();
  const { pending: saving, run: queue } = useAsyncQueue();
  const { pending: togglingMonitoring, run: runMonitoring } = useExclusiveAsyncAction();
  const persistedSettings = settings ?? {};
  const runtime = normalizeAudioRuntimeSettings(persistedSettings);
  const { audioDriver, monitoringEnabled, volume } = runtime;
  const targetLevel = resolveMonitorTarget(enabled, monitoringEnabled, localSpeakingLevel, signal);
  const resetSpeakerState = useCallback(
    () => {
      clearTimeout(speakerTimer.current);
      speakerTimer.current = setTimeout(() => {
        speakerTimer.current = null;
        setSpeakerTestState("idle");
      }, 1800);
    },
    // Stryker disable next-line ArrayDeclaration: stable state setter and timer ref.
    []
  );
  useEffect(
    () => () => clearTimeout(speakerTimer.current),
    // Stryker disable next-line ArrayDeclaration: stable timer ref; mount-only cleanup.
    []
  );
  useEffect(() => {
    monitorTarget.current = targetLevel;
    if (targetLevel > 0) monitorPeak.current = performance.now() + 240;
    if (!monitoringEnabled) {
      monitorPeak.current = 0;
      setMonitorLevel(0);
    }
  }, [targetLevel, monitoringEnabled]);
  useEffect(() => {
    if (!enabled || !monitoringEnabled) return;
    const timer = setInterval(() => {
      const target = monitorTarget.current;
      const now = performance.now();
      setMonitorLevel((current) => nextMonitorLevel(current, target, now, monitorPeak.current));
    }, 50);
    return () => clearInterval(timer);
  }, [enabled, monitoringEnabled]);
  const stopLocalMeter = useCallback(() => {
    monitorRequest.current += 1;
    monitorPending.current = 0;
    stopSpeakingMeter("local");
    stopStream(monitorStream.current);
    monitorStream.current = null;
  }, [stopSpeakingMeter]);
  const startLocalMeter = useCallback(async () => {
    const { mediaDevices } = navigator;
    if (typeof mediaDevices?.getUserMedia !== "function") return false;
    const request = ++monitorRequest.current;
    monitorPending.current = request;
    stopSpeakingMeter("local");
    stopStream(monitorStream.current);
    monitorStream.current = null;
    const selected = preferences.monitorInputDeviceId;
    const base = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1
    };
    const candidates =
      selected && selected !== "default"
        ? [{ ...base, deviceId: { exact: selected } }, base]
        : [base];
    try {
      for (const audio of candidates) {
        let stream;
        try {
          stream = await mediaDevices.getUserMedia({ audio });
          if (request !== monitorRequest.current) {
            stopStream(stream);
            return false;
          }
          monitorStream.current = stream;
          prepareSpeakingMeter();
          startSpeakingMeter("local", stream);
          return true;
        } catch {
          stopStream(stream);
          if (request !== monitorRequest.current) return false;
        }
      }
      return false;
    } finally {
      if (monitorPending.current === request) monitorPending.current = 0;
    }
  }, [
    preferences.monitorInputDeviceId,
    prepareSpeakingMeter,
    startSpeakingMeter,
    stopSpeakingMeter
  ]);
  useEffect(() => {
    if (!enabled || !monitoringEnabled) {
      stopLocalMeter();
      return stopLocalMeter;
    }
    let cancelled = false;
    startLocalMeter().then((started) => {
      if (cancelled && started) stopLocalMeter();
    });
    const unlock = () => {
      prepareSpeakingMeter();
      if (!monitorStream.current && !monitorPending.current) startLocalMeter();
    };
    const events = ["pointerdown", "keydown"];
    events.forEach((event) => globalThis.addEventListener(event, unlock, { once: true }));
    return () => {
      cancelled = true;
      events.forEach((event) => globalThis.removeEventListener(event, unlock));
      stopLocalMeter();
    };
  }, [enabled, monitoringEnabled, prepareSpeakingMeter, startLocalMeter, stopLocalMeter]);
  useEffect(() => {
    if (!enabled) {
      setBrowserDevices(EMPTY_BROWSER_DEVICES);
      return undefined;
    }
    const { mediaDevices } = navigator;
    if (typeof mediaDevices?.enumerateDevices !== "function") return;
    mediaDevices
      .enumerateDevices()
      .then((devices) => setBrowserDevices(groupBrowserAudioDevices(devices)))
      .catch(
        // Stryker disable next-line BlockStatement: enumeration failure is intentionally ignored.
        () => {}
      );
  }, [enabled]);
  const execute = (action, errorText) =>
    queue(async () => {
      try {
        const result = await action();
        await refresh();
        return { ok: true, value: result };
      } catch (error) {
        await alert(`${errorText}: ${getErrorMessage(error)}`);
        return { ok: false, error };
      }
    });
  const updateBackend = (patch) =>
    execute(async () => {
      const updated = await api.updateAudioSettings(patch);
      try {
        globalThis.dispatchEvent(new CustomEvent("audio-settings-changed", { detail: updated }));
      } catch {
        // test runtime
      }
      return updated;
    }, translateSaved("Не удалось сохранить аудионастройки"));
  const updatePreference = (name, value) =>
    setPreferences(() => {
      const next = saveAudioPreferences({ [name]: value });
      api.updateUiPreferences("audio", next).catch(() => {});
      return next;
    });
  const toggleMonitoring = () =>
    runMonitoring(async () => {
      const enabling = !monitoringEnabled;
      const result = await execute(
        enabling ? api.startDirectMonitoring : api.stopDirectMonitoring,
        translateSaved("Не удалось изменить прослушивание")
      );
      if (!result.ok) {
        if (enabling) stopLocalMeter();
        return false;
      }
      if (enabling) {
        prepareSpeakingMeter();
        await startLocalMeter();
      } else stopLocalMeter();
      return true;
    });
  const testSpeakers = useCallback(async () => {
    if (speakerTestState === "playing") return;
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) {
      await alert(translateSaved("Не удалось запустить проверку звука."));
      return;
    }
    setSpeakerTestState("playing");
    let context;
    let audio;
    let closeContext = async () => {};
    try {
      context = new AudioContext({ latencyHint: "interactive" });
      closeContext = () => context.close();
      if (context.state === "suspended") await context.resume();
      const destination = context.createMediaStreamDestination();
      const gain = context.createGain();
      const oscillator = context.createOscillator();
      const now = context.currentTime;
      [
        ["setValueAtTime", 0.0001, now],
        ["exponentialRampToValueAtTime", 0.14, now + 0.04],
        ["setValueAtTime", 0.14, now + 0.55],
        ["exponentialRampToValueAtTime", 0.0001, now + 0.85]
      ].forEach(([method, value, time]) => gain.gain[method](value, time));
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(523.25, now);
      oscillator.frequency.setValueAtTime(659.25, now + 0.42);
      oscillator.connect(gain);
      gain.connect(destination);
      audio = document.createElement("audio");
      audio.srcObject = destination.stream;
      audio.volume = 1;
      const output = preferences.monitorOutputDeviceId;
      if (output && output !== "default" && typeof audio.setSinkId === "function") {
        await audio.setSinkId(output);
      }
      await audio.play();
      oscillator.start();
      oscillator.stop(now + 0.9);
      await new Promise((resolve) => setTimeout(resolve, 1050));
      setSpeakerTestState("success");
    } catch (error) {
      setSpeakerTestState("error");
      await alert(
        translateSaved("Не удалось проверить динамики: {0}", { 0: getErrorMessage(error) })
      );
    } finally {
      resetSpeakerState();
      if (audio) {
        audio.pause();
        stopStream(audio.srcObject);
      }
      try {
        await closeContext();
      } catch {
        // already closed
      }
    }
  }, [alert, preferences.monitorOutputDeviceId, resetSpeakerState, speakerTestState]);
  const options = {
    inputDevices: createIndexedDeviceOptions(devices),
    outputDevices: createIndexedDeviceOptions(outputs, translateSaved("Системное устройство")),
    bufferSizes: createBufferSizeOptions(),
    asioDrivers: (asioDrivers ?? []).map(({ name }) => ({ value: name, label: name })),
    audioDrivers: [
      { value: "auto", label: translateSaved("Автоматически · рекомендуется") },
      ...(asioDrivers?.length
        ? [{ value: "asio", label: translateSaved("ASIO · для аудиоинтерфейсов") }]
        : [])
    ],
    browserInputs: createBrowserDeviceOptions(browserDevices.inputs, translateSaved("Микрофон")),
    browserOutputs: createBrowserDeviceOptions(
      browserDevices.outputs,
      translateSaved("Аудиоустройство")
    )
  };
  return {
    values: {
      ...runtime,
      input_device_id: persistedSettings.input_device_id ?? "",
      output_device_id: persistedSettings.output_device_id ?? "",
      asio_driver_name: persistedSettings.asio_driver_name ?? "",
      buffer_size: persistedSettings.buffer_size ?? 64,
      audio_driver: audioDriver,
      volume
    },
    preferences,
    options,
    states: { monitoringEnabled, monitorLevel, speakerTestState, saving, togglingMonitoring },
    actions: { testSpeakers, toggleMonitoring },
    updateBackend,
    updatePreference
  };
}
