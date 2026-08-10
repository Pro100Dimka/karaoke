import { ArrowLeft, Headphones } from "lucide-react";

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../api/client";
import { useAppDialog } from "../../contexts/AppDialog";
import useSpeakingLevels from "../../contexts/hooks/useSpeakingLevels";
import { useRadio } from "../../contexts/radio";

import useAsyncQueue from "../../hooks/useAsyncQueue";
import useExclusiveAsyncAction from "../../hooks/useExclusiveAsyncAction";
import { usePolling } from "../../hooks/usePolling";

import {
  Button,
  Progress,
  Select,
  Slider,
  Stack,
  Switch,
  TextField
} from "../../theme/ui";

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

import { EMPTY_BROWSER_DEVICES, SCREEN_BY_ID, SETTINGS } from "./config";

const PARSERS = {
  default: (value) => value,

  number: (value) => (value === "" ? "" : Number(value)),

  "nullable-number": (value) => (value === "" ? null : Number(value))
};

function getSignalLevel(signal) {
  const db = Number(signal?.rms_db ?? signal?.rms_dbfs);

  if (!Number.isFinite(db)) {
    return 0;
  }

  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}

function useAudioSource() {
  const { alert } = useAppDialog();

  const { data: settings, refresh } = usePolling(
    api.getAudioSettings,
    15000,
    []
  );

  const { data: devices } = usePolling(api.listAudioDevices, 30000, []);

  const { data: outputs } = usePolling(api.listAudioOutputDevices, 30000, []);

  const { data: asioDrivers } = usePolling(api.listAsioDrivers, 30000, []);

  const { data: signal } = usePolling(api.getSignalQuality, 80, []);

  const [browserDevices, setBrowserDevices] = useState(EMPTY_BROWSER_DEVICES);

  const [preferences, setPreferences] = useState(getAudioPreferences);

  const [speakerTestState, setSpeakerTestState] = useState("idle");

  const [monitorLevel, setMonitorLevel] = useState(0);

  const monitorStreamRef = useRef(null);

  const speakerResetTimerRef = useRef(null);

  const monitorTargetRef = useRef(0);

  const monitorPeakHoldUntilRef = useRef(0);

  const {
    localSpeakingLevel,
    prepareSpeakingMeter,
    startSpeakingMeter,
    stopSpeakingMeter
  } = useSpeakingLevels();

  const { pending: saving, run: enqueueAudioUpdate } = useAsyncQueue();

  const { pending: togglingMonitoring, run: runMonitoringToggle } =
    useExclusiveAsyncAction();

  const runtimeSettings = normalizeAudioRuntimeSettings(settings);

  const { audioDriver, monitoringEnabled, volume } = runtimeSettings;

  const rawMonitorLevel = monitoringEnabled ? getSignalLevel(signal) : 0;

  const monitorTargetLevel = monitoringEnabled
    ? Math.max(localSpeakingLevel * 100, rawMonitorLevel)
    : 0;

  const scheduleSpeakerReset = useCallback(() => {
    if (speakerResetTimerRef.current) {
      globalThis.clearTimeout(speakerResetTimerRef.current);
    }

    speakerResetTimerRef.current = globalThis.setTimeout(() => {
      speakerResetTimerRef.current = null;

      setSpeakerTestState("idle");
    }, 1800);
  }, []);

  useEffect(
    () => () => {
      if (speakerResetTimerRef.current) {
        globalThis.clearTimeout(speakerResetTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    const now = performance.now();

    monitorTargetRef.current = monitorTargetLevel;

    if (monitorTargetLevel > 0) {
      monitorPeakHoldUntilRef.current = now + 240;
    }

    if (!monitoringEnabled) {
      monitorPeakHoldUntilRef.current = 0;
      setMonitorLevel(0);
    }
  }, [monitorTargetLevel, monitoringEnabled]);

  useEffect(() => {
    if (!monitoringEnabled) {
      return undefined;
    }

    const intervalId = globalThis.setInterval(() => {
      const target = monitorTargetRef.current;

      const now = performance.now();

      setMonitorLevel((current) => {
        if (target >= current) {
          return Math.min(100, target);
        }

        if (now < monitorPeakHoldUntilRef.current) {
          return current;
        }

        const next = current * 0.78;

        return next < 0.8 ? 0 : next;
      });
    }, 50);

    return () => globalThis.clearInterval(intervalId);
  }, [monitoringEnabled]);

  const stopLocalMeter = useCallback(() => {
    stopSpeakingMeter("local");

    monitorStreamRef.current?.getTracks?.().forEach((track) => track.stop());

    monitorStreamRef.current = null;
  }, [stopSpeakingMeter]);

  const startLocalMeter = useCallback(async () => {
    const mediaDevices = globalThis.navigator?.mediaDevices;

    if (typeof mediaDevices?.getUserMedia !== "function") {
      return false;
    }

    stopLocalMeter();

    const selectedInput = preferences.monitorInputDeviceId;

    const baseAudio = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1
    };

    const candidates = [];

    if (selectedInput && selectedInput !== "default") {
      candidates.push({
        ...baseAudio,

        deviceId: {
          exact: selectedInput
        }
      });
    }

    candidates.push(baseAudio);

    let stream = null;

    for (const audio of candidates) {
      try {
        stream = await mediaDevices.getUserMedia({
          audio
        });

        break;
      } catch {
        // fallback
      }
    }

    if (!stream) {
      return false;
    }

    monitorStreamRef.current = stream;

    prepareSpeakingMeter();

    startSpeakingMeter("local", stream);

    return true;
  }, [
    preferences.monitorInputDeviceId,
    prepareSpeakingMeter,
    startSpeakingMeter,
    stopLocalMeter
  ]);

  useEffect(() => {
    let cancelled = false;

    if (!monitoringEnabled) {
      stopLocalMeter();

      return stopLocalMeter;
    }

    startLocalMeter().then((started) => {
      if (cancelled && started) {
        stopLocalMeter();
      }
    });

    const unlockOnGesture = () => {
      prepareSpeakingMeter();

      if (!monitorStreamRef.current) {
        startLocalMeter();
      }
    };

    globalThis.addEventListener?.("pointerdown", unlockOnGesture, {
      once: true
    });

    globalThis.addEventListener?.("keydown", unlockOnGesture, { once: true });

    return () => {
      cancelled = true;

      globalThis.removeEventListener?.("pointerdown", unlockOnGesture);

      globalThis.removeEventListener?.("keydown", unlockOnGesture);

      stopLocalMeter();
    };
  }, [
    monitoringEnabled,
    prepareSpeakingMeter,
    startLocalMeter,
    stopLocalMeter
  ]);

  useEffect(() => {
    const mediaDevices = globalThis.navigator?.mediaDevices;

    const enumerateDevices = mediaDevices?.enumerateDevices;

    if (typeof enumerateDevices !== "function") {
      return undefined;
    }

    let active = true;

    enumerateDevices
      .call(mediaDevices)
      .then((entries) => {
        if (active) {
          setBrowserDevices(groupBrowserAudioDevices(entries));
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const runAudioAction = (action, errorText) =>
    enqueueAudioUpdate(async () => {
      try {
        await action();
        await refresh?.();
      } catch (error) {
        await alert(`${errorText}: ${getErrorMessage(error)}`);
      }
    });

  const updateBackend = (patch) =>
    runAudioAction(async () => {
      const updated = await api.updateAudioSettings(patch);

      try {
        globalThis.dispatchEvent?.(
          new CustomEvent("audio-settings-changed", {
            detail: updated
          })
        );
      } catch {
        // non browser env
      }

      return updated;
    }, "Не удалось сохранить аудионастройки");

  const updatePreference = (name, value) => {
    setPreferences(
      saveAudioPreferences({
        [name]: value
      })
    );
  };

  const toggleMonitoring = () => {
    if (!monitoringEnabled) {
      prepareSpeakingMeter();

      startLocalMeter().catch(() => {});
    } else {
      stopLocalMeter();
    }

    return runMonitoringToggle(() =>
      runAudioAction(
        monitoringEnabled
          ? api.stopDirectMonitoring
          : api.startDirectMonitoring,

        "Не удалось изменить прослушивание"
      )
    );
  };

  const testSpeakers = useCallback(async () => {
    if (speakerTestState === "playing") {
      return;
    }

    const AudioContextClass =
      globalThis.AudioContext || globalThis.webkitAudioContext;

    if (typeof AudioContextClass !== "function") {
      await alert("Не удалось запустить проверку звука.");

      return;
    }

    setSpeakerTestState("playing");

    let context;
    let audio;

    try {
      context = new AudioContextClass({
        latencyHint: "interactive"
      });

      if (context.state === "suspended") {
        await context.resume();
      }

      const destination = context.createMediaStreamDestination();

      const gain = context.createGain();

      const oscillator = context.createOscillator();

      gain.gain.setValueAtTime(0.0001, context.currentTime);

      gain.gain.exponentialRampToValueAtTime(0.14, context.currentTime + 0.04);

      gain.gain.setValueAtTime(0.14, context.currentTime + 0.55);

      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        context.currentTime + 0.85
      );

      oscillator.type = "sine";

      oscillator.frequency.setValueAtTime(523.25, context.currentTime);

      oscillator.frequency.setValueAtTime(659.25, context.currentTime + 0.42);

      oscillator.connect(gain);
      gain.connect(destination);

      audio = document.createElement("audio");

      audio.srcObject = destination.stream;

      audio.volume = 1;

      const outputId = preferences.monitorOutputDeviceId;

      if (
        outputId &&
        outputId !== "default" &&
        typeof audio.setSinkId === "function"
      ) {
        await audio.setSinkId(outputId);
      }

      await audio.play();

      oscillator.start();

      oscillator.stop(context.currentTime + 0.9);

      await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 1050);
      });

      setSpeakerTestState("success");

      scheduleSpeakerReset();
    } catch (error) {
      setSpeakerTestState("error");

      await alert(`Не удалось проверить динамики: ${getErrorMessage(error)}`);

      scheduleSpeakerReset();
    } finally {
      try {
        audio?.pause?.();

        audio?.srcObject?.getTracks?.().forEach((track) => track.stop());
      } catch {
        // ignore
      }

      try {
        await context?.close?.();
      } catch {
        // ignore
      }
    }
  }, [
    alert,
    preferences.monitorOutputDeviceId,
    scheduleSpeakerReset,
    speakerTestState
  ]);

  const options = {
    inputDevices: createIndexedDeviceOptions(devices),

    outputDevices: createIndexedDeviceOptions(outputs, "Системное устройство"),

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
      ...runtimeSettings,

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

const FIELD_RENDERERS = {
  select: ({ props, value, change }) => (
    <Select {...props} value={value ?? ""} onChange={change} />
  ),

  slider: ({ props, value, change }) => (
    <Slider {...props} value={value ?? 0} onChange={change} />
  ),

  text: ({ props, value, change, blur }) => (
    <TextField
      {...props}
      type="text"
      value={value ?? ""}
      onChange={change}
      onBlur={(event) => blur(event?.target?.value ?? value)}
    />
  ),

  number: ({ props, value, change, blur }) => (
    <TextField
      {...props}
      type="number"
      value={value ?? ""}
      onChange={change}
      onBlur={(event) => blur(event?.target?.value ?? value)}
    />
  ),

  readonly: ({ props, value }) => (
    <TextField {...props} value={value ?? ""} readOnly />
  ),

  toggle: ({ props, value, change }) => (
    <Switch {...props} checked={Boolean(value)} onChange={change} />
  ),

  action: ({ props, field, source }) => {
    const pending =
      field.action === "testSpeakers" &&
      source.states.speakerTestState === "playing";

    return (
      <Button
        {...props}
        disabled={pending}
        onClick={source.actions[field.action]}
      >
        {pending ? field.pendingText : (field.idleText ?? field.label)}
      </Button>
    );
  },

  monitor: ({ props, field, value, source }) => (
    <Stack gap={2}>
      <Stack direction="row" align="center" justify="space-between" gap={2}>
        <Stack direction="row" align="center" gap={2}>
          <Headphones size={18} />

          <strong>{field.label}</strong>
        </Stack>

        <Button
          variant="solid"
          tone={value ? "danger" : "primary"}
          disabled={source.states.saving || source.states.togglingMonitoring}
          onClick={source.actions[field.action]}
        >
          {value ? "Выключить" : "Включить"}
        </Button>
      </Stack>

      <Progress value={source.states[field.level] ?? 0} />
    </Stack>
  )
};

function SettingsField({ field, form, radio, audio, onChange, onBlur }) {
  const {
    type,
    source = "form",
    name,
    parse = "default",
    save,
    options,
    startIcon: StartIcon,
    formatLabel,
    visibleWhen,
    disabledWhen,
    ...props
  } = field;

  const sources = {
    form: {
      value: form[name],

      change: (value) => onChange(name, value),

      save: (value) => onBlur(name, value),

      options
    },

    radio: {
      value: radio[name],

      change: {
        stationId: radio.setStation,

        volume: radio.setVolume
      }[name],

      save: null,

      options:
        options === "stations"
          ? radio.stations.map(({ id, name: label, description }) => ({
              value: id,
              label,
              description
            }))
          : options
    },

    audio: {
      value: audio.values[name],

      change: (value) =>
        audio.updateBackend({
          [name]: value
        }),

      save: null,

      options:
        typeof options === "string" ? (audio.options[options] ?? []) : options,

      ...audio
    },

    audioPreference: {
      value: audio.preferences[name],

      change: (value) => audio.updatePreference(name, value),

      save: null,

      options:
        typeof options === "string" ? (audio.options[options] ?? []) : options,

      ...audio
    }
  };

  const current = sources[source] ?? sources.form;

  if (visibleWhen && audio.values[visibleWhen.field] !== visibleWhen.equals) {
    return null;
  }

  const parser = PARSERS[parse] ?? PARSERS.default;

  const change = (rawValue) => {
    const nextValue = parser(rawValue);

    current.change?.(nextValue);

    if (save === "change") {
      current.save?.(nextValue);
    }
  };

  const blur = (rawValue) => {
    if (save !== "blur") {
      return;
    }

    current.save?.(parser(rawValue));
  };

  const fieldProps = {
    ...props,

    options: Array.isArray(current.options) ? current.options : [],

    disabled: disabledWhen
      ? Boolean(audio.states[disabledWhen])
      : props.disabled
  };

  if (StartIcon) {
    fieldProps.startIcon = <StartIcon size={16} />;
  }

  if (formatLabel) {
    fieldProps.label = formatLabel(current.value);
  }

  const render = FIELD_RENDERERS[type];

  return (
    render?.({
      props: fieldProps,
      field,
      value: current.value,
      change,
      blur,
      source: current
    }) ?? null
  );
}

export default function SettingsContent({
  tab,
  service,
  form,
  onChange,
  onFieldBlur,
  onOpenService,
  onCloseService
}) {
  const radio = useRadio();

  const audio = useAudioSource();

  const ServiceScreen = SCREEN_BY_ID[service]?.component;

  if (ServiceScreen) {
    return (
      <Stack className="settings-service-screen" gap={2}>
        <Button variant="ghost" onClick={onCloseService}>
          <ArrowLeft size={16} />
          Назад
        </Button>

        <ServiceScreen />
      </Stack>
    );
  }

  if (tab === "service") {
    return (
      <Stack className="settings-service-grid u-grid-2" gap={2}>
        {SETTINGS.service.screens.map(({ id, title, text }) => (
          <Button
            key={id}
            className="settings-service-link"
            onClick={() => onOpenService(id)}
          >
            <Stack align="start" gap={1}>
              <strong>{title}</strong>

              <span>{text}</span>

              <b>Открыть →</b>
            </Stack>
          </Button>
        ))}
      </Stack>
    );
  }

  const section = SETTINGS[tab];

  if (!section) {
    return null;
  }

  return (
    <Stack
      className={section.className}
      gap={2}
      sx={{
        padding: "0 1rem"
      }}
    >
      {section.fields?.map((field) => (
        <SettingsField
          key={field.name}
          field={field}
          form={form}
          radio={radio}
          audio={audio}
          onChange={onChange}
          onBlur={onFieldBlur}
        />
      ))}
    </Stack>
  );
}
