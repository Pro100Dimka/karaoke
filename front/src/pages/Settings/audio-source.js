/* eslint-disable no-promise-executor-return */
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../api/client";

import { useAppDialog } from "../../contexts/AppDialog";
import useSpeakingLevels from "../../contexts/hooks/useSpeakingLevels";

import useAsyncQueue from "../../hooks/useAsyncQueue";
import useExclusiveAsyncAction from "../../hooks/useExclusiveAsyncAction";
import { usePolling } from "../../hooks/usePolling";

import {
  getAudioPreferences,
  saveAudioPreferences
} from "../../utils/audio-preferences";

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

const stopStream = (stream) =>
  stream?.getTracks?.().forEach((track) => track.stop());

const getSignalLevel = (signal) => {
  const db = Number(signal?.rms_db ?? signal?.rms_dbfs);

  return Number.isFinite(db)
    ? Math.max(0, Math.min(100, ((db + 60) / 60) * 100))
    : 0;
};

export default function useAudioSettingsSource({ enabled = true } = {}) {
  const { alert } = useAppDialog();

  const { data: settings, refresh } = usePolling(
    () => (enabled ? api.getAudioSettings() : Promise.resolve(null)),
    enabled ? 15000 : 0,
    [enabled]
  );

  const { data: devices } = usePolling(
    () => (enabled ? api.listAudioDevices() : Promise.resolve([])),
    enabled ? 30000 : 0,
    [enabled]
  );

  const { data: outputs } = usePolling(
    () => (enabled ? api.listAudioOutputDevices() : Promise.resolve([])),
    enabled ? 30000 : 0,
    [enabled]
  );

  const { data: asioDrivers } = usePolling(
    () => (enabled ? api.listAsioDrivers() : Promise.resolve([])),
    enabled ? 30000 : 0,
    [enabled]
  );

  const { data: signal } = usePolling(
    () => (enabled ? api.getSignalQuality() : Promise.resolve(null)),
    enabled ? 80 : 0,
    [enabled]
  );

  const [browserDevices, setBrowserDevices] = useState(EMPTY_BROWSER_DEVICES);

  const [preferences, setPreferences] = useState(getAudioPreferences);

  const [speakerTestState, setSpeakerTestState] = useState("idle");

  const [monitorLevel, setMonitorLevel] = useState(0);

  const monitorStream = useRef(null);

  const speakerTimer = useRef(null);

  const monitorTarget = useRef(0);

  const monitorPeak = useRef(0);

  const {
    localSpeakingLevel,
    prepareSpeakingMeter,
    startSpeakingMeter,
    stopSpeakingMeter
  } = useSpeakingLevels();

  const { pending: saving, run: queue } = useAsyncQueue();

  const { pending: togglingMonitoring, run: runMonitoring } =
    useExclusiveAsyncAction();

  const runtime = normalizeAudioRuntimeSettings(settings);

  const { audioDriver, monitoringEnabled, volume } = runtime;

  const targetLevel = enabled && monitoringEnabled
    ? Math.max(localSpeakingLevel * 100, getSignalLevel(signal))
    : 0;

  const resetSpeakerState = useCallback(() => {
    clearTimeout(speakerTimer.current);

    speakerTimer.current = setTimeout(() => {
      speakerTimer.current = null;

      setSpeakerTestState("idle");
    }, 1800);
  }, []);

  useEffect(() => () => clearTimeout(speakerTimer.current), []);

  useEffect(() => {
    monitorTarget.current = targetLevel;

    if (targetLevel > 0) {
      monitorPeak.current = performance.now() + 240;
    }

    if (!monitoringEnabled) {
      monitorPeak.current = 0;

      setMonitorLevel(0);
    }
  }, [targetLevel, monitoringEnabled]);

  useEffect(() => {
    if (!enabled || !monitoringEnabled) {
      return;
    }

    const timer = setInterval(() => {
      const target = monitorTarget.current;

      const now = performance.now();

      setMonitorLevel((current) => {
        if (target >= current) {
          return Math.min(100, target);
        }

        if (now < monitorPeak.current) {
          return current;
        }

        const next = current * 0.78;

        return next < 0.8 ? 0 : next;
      });
    }, 50);

    return () => clearInterval(timer);
  }, [enabled, monitoringEnabled]);

  const stopLocalMeter = useCallback(() => {
    stopSpeakingMeter("local");

    stopStream(monitorStream.current);

    monitorStream.current = null;
  }, [stopSpeakingMeter]);

  const startLocalMeter = useCallback(async () => {
    const mediaDevices = globalThis.navigator?.mediaDevices;

    if (typeof mediaDevices?.getUserMedia !== "function") {
      return false;
    }

    stopLocalMeter();

    const selected = preferences.monitorInputDeviceId;

    const base = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1
    };

    const candidates =
      selected && selected !== "default"
        ? [
            {
              ...base,

              deviceId: {
                exact: selected
              }
            },

            base
          ]
        : [base];

    for (const audio of candidates) {
      try {
        const stream = await mediaDevices.getUserMedia({
          audio
        });

        monitorStream.current = stream;

        prepareSpeakingMeter();

        startSpeakingMeter("local", stream);

        return true;
      } catch {
        // next device
      }
    }

    return false;
  }, [
    preferences.monitorInputDeviceId,
    prepareSpeakingMeter,
    startSpeakingMeter,
    stopLocalMeter
  ]);

  useEffect(() => {
    if (!enabled || !monitoringEnabled) {
      stopLocalMeter();

      return stopLocalMeter;
    }

    let cancelled = false;

    startLocalMeter().then((started) => {
      if (cancelled && started) {
        stopLocalMeter();
      }
    });

    const unlock = () => {
      prepareSpeakingMeter();

      if (!monitorStream.current) {
        startLocalMeter();
      }
    };

    const events = ["pointerdown", "keydown"];

    events.forEach((event) =>
      globalThis.addEventListener?.(event, unlock, { once: true })
    );

    return () => {
      cancelled = true;

      events.forEach((event) =>
        globalThis.removeEventListener?.(event, unlock)
      );

      stopLocalMeter();
    };
  }, [
    enabled,
    monitoringEnabled,
    prepareSpeakingMeter,
    startLocalMeter,
    stopLocalMeter
  ]);

  useEffect(() => {
    if (!enabled) {
      setBrowserDevices(EMPTY_BROWSER_DEVICES);
      return undefined;
    }

    const mediaDevices = globalThis.navigator?.mediaDevices;

    if (typeof mediaDevices?.enumerateDevices !== "function") {
      return;
    }

    let active = true;

    mediaDevices
      .enumerateDevices()
      .then((devices) => {
        if (active) {
          setBrowserDevices(groupBrowserAudioDevices(devices));
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [enabled]);

  const execute = (action, errorText) =>
    queue(async () => {
      try {
        const result = await action();

        await refresh?.();

        return { ok: true, value: result };
      } catch (error) {
        await alert(`${errorText}: ${getErrorMessage(error)}`);
        return { ok: false, error };
      }
    });

  const updateBackend = (patch) =>
    execute(
      async () => {
        const updated = await api.updateAudioSettings(patch);

        try {
          globalThis.dispatchEvent?.(
            new CustomEvent("audio-settings-changed", {
              detail: updated
            })
          );
        } catch {
          // test runtime
        }

        return updated;
      },

      "Не удалось сохранить аудионастройки"
    );

  const updatePreference = (name, value) =>
    setPreferences(
      saveAudioPreferences({
        [name]: value
      })
    );

  const toggleMonitoring = () =>
    runMonitoring(async () => {
      const enabling = !monitoringEnabled;
      const result = await execute(
        enabling ? api.startDirectMonitoring : api.stopDirectMonitoring,
        "Не удалось изменить прослушивание"
      );

      if (!result?.ok) {
        if (enabling) stopLocalMeter();
        return false;
      }

      if (enabling) {
        prepareSpeakingMeter();
        await startLocalMeter().catch(() => false);
      } else {
        stopLocalMeter();
      }

      return true;
    });

  const testSpeakers = useCallback(async () => {
    if (speakerTestState === "playing") {
      return;
    }

    const AudioContext =
      globalThis.AudioContext || globalThis.webkitAudioContext;

    if (!AudioContext) {
      await alert("Не удалось запустить проверку звука.");

      return;
    }

    setSpeakerTestState("playing");

    let context;
    let audio;

    try {
      context = new AudioContext({
        latencyHint: "interactive"
      });

      if (context.state === "suspended") {
        await context.resume();
      }

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

      if (
        output &&
        output !== "default" &&
        typeof audio.setSinkId === "function"
      ) {
        await audio.setSinkId(output);
      }

      await audio.play();

      oscillator.start();

      oscillator.stop(now + 0.9);

      await new Promise((resolve) => setTimeout(resolve, 1050));

      setSpeakerTestState("success");
    } catch (error) {
      setSpeakerTestState("error");

      await alert(`Не удалось проверить динамики: ${getErrorMessage(error)}`);
    } finally {
      resetSpeakerState();

      audio?.pause?.();

      stopStream(audio?.srcObject);

      try {
        await context?.close?.();
      } catch {
        // already closed
      }
    }
  }, [
    alert,
    preferences.monitorOutputDeviceId,
    resetSpeakerState,
    speakerTestState
  ]);

  const options = {
    inputDevices: createIndexedDeviceOptions(devices ?? []),

    outputDevices: createIndexedDeviceOptions(
      outputs ?? [],
      "Системное устройство"
    ),

    bufferSizes: createBufferSizeOptions(),

    asioDrivers: (asioDrivers ?? []).map(({ name }) => ({
      value: name,
      label: name
    })),

    audioDrivers: [
      {
        value: "auto",
        label: "Автоматически · рекомендуется"
      },

      ...(asioDrivers?.length
        ? [
            {
              value: "asio",

              label: "ASIO · для аудиоинтерфейсов"
            }
          ]
        : [])
    ],

    browserInputs: createBrowserDeviceOptions(
      browserDevices.inputs,
      "Микрофон"
    ),

    browserOutputs: createBrowserDeviceOptions(
      browserDevices.outputs,
      "Аудиоустройство"
    )
  };

  return {
    values: {
      ...runtime,

      input_device_id: settings?.input_device_id ?? "",

      output_device_id: settings?.output_device_id ?? "",

      asio_driver_name: settings?.asio_driver_name ?? "",

      buffer_size: settings?.buffer_size ?? 64,

      audio_driver: audioDriver,

      volume
    },

    preferences,
    options,

    states: {
      monitoringEnabled,
      monitorLevel,
      speakerTestState,
      saving,
      togglingMonitoring
    },

    actions: {
      testSpeakers,
      toggleMonitoring
    },

    updateBackend,
    updatePreference
  };
}
