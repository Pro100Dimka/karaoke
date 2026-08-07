import { Activity, Headphones, Mic2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import Dropdown from "../../components/fields/Dropdown";
import Button from "../../components/fields/button";
import Field from "../../components/fields/field";
import RangeInput from "../../components/fields/range-input";
import { useAppDialog } from "../../contexts/AppDialog";
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
import {
  EMPTY_BROWSER_DEVICES,
  LATENCY_OPTIONS,
  MONITOR_MODE_OPTIONS
} from "./audio-options";

function GroupHeader({ icon: Icon, title, text }) {
  return (
    <header className="audio-settings-group__header">
      <Icon size={18} />

      <div>
        <strong>{title}</strong>
        <small>{text}</small>
      </div>
    </header>
  );
}

function DropdownField({ label, hint, value, options, disabled, onChange }) {
  return (
    <Field label={label} hint={hint} variant="card">
      <Dropdown
        value={value}
        options={options}
        disabled={disabled}
        onChange={onChange}
      />
    </Field>
  );
}

function getSignalLevel(signal) {
  const db = Number(signal?.rms_db ?? signal?.rms_dbfs);

  if (!Number.isFinite(db)) return 0;

  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}

export default function AudioSettings() {
  const { alert } = useAppDialog();

  const { data: settings, refresh } = usePolling(
    api.getAudioSettings,
    15000,
    []
  );
  const { data: devices } = usePolling(api.listAudioDevices, 30000, []);
  const { data: outputs } = usePolling(api.listAudioOutputDevices, 30000, []);
  const { data: asioDrivers } = usePolling(api.listAsioDrivers, 30000, []);
  const { data: signal } = usePolling(api.getSignalQuality, 350, []);

  const [browserDevices, setBrowserDevices] = useState(EMPTY_BROWSER_DEVICES);
  const [preferences, setPreferences] = useState(getAudioPreferences);
  const [monitorLevel, setMonitorLevel] = useState(0);
  const [liveMonitorAvailable, setLiveMonitorAvailable] = useState(false);
  const liveMeterCleanupRef = useRef(null);

  const { pending: saving, run: enqueueAudioUpdate } = useAsyncQueue();
  const { pending: togglingMonitoring, run: runMonitoringToggle } =
    useExclusiveAsyncAction();

  const runtimeSettings = normalizeAudioRuntimeSettings(settings);
  const audioDriver = runtimeSettings.audioDriver;
  const monitoringEnabled = runtimeSettings.monitoringEnabled;
  const volume = runtimeSettings.volume;
  const rawMonitorLevel = monitoringEnabled ? getSignalLevel(signal) : 0;

  useEffect(() => {
    liveMeterCleanupRef.current?.();
    liveMeterCleanupRef.current = null;
    setLiveMonitorAvailable(false);

    if (!monitoringEnabled) {
      setMonitorLevel(0);
      return undefined;
    }

    const mediaDevices = globalThis.navigator?.mediaDevices;
    if (typeof mediaDevices?.getUserMedia !== "function") return undefined;

    let cancelled = false;
    let stream = null;
    let audioContext = null;
    let source = null;
    let analyser = null;
    let intervalId = null;

    const stop = () => {
      cancelled = true;
      if (intervalId) globalThis.clearInterval(intervalId);
      try { source?.disconnect(); } catch {}
      try { analyser?.disconnect(); } catch {}
      stream?.getTracks?.().forEach((track) => track.stop());
      if (audioContext?.state !== "closed") {
        try { Promise.resolve(audioContext?.close?.()).catch(() => {}); } catch {}
      }
    };

    liveMeterCleanupRef.current = stop;

    const selectedInput = preferences.monitorInputDeviceId;
    const audio = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      ...(selectedInput && selectedInput !== "default"
        ? { deviceId: { exact: selectedInput } }
        : {})
    };

    mediaDevices
      .getUserMedia({ audio })
      .then((nextStream) => {
        if (cancelled) {
          nextStream.getTracks?.().forEach((track) => track.stop());
          return;
        }

        const AudioContextClass =
          globalThis.AudioContext || globalThis.webkitAudioContext;
        if (typeof AudioContextClass !== "function") {
          nextStream.getTracks?.().forEach((track) => track.stop());
          return;
        }

        stream = nextStream;
        audioContext = new AudioContextClass({ latencyHint: "interactive" });
        source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.72;
        source.connect(analyser);

        const samples = new Uint8Array(analyser.fftSize);
        let smoothed = 0;
        setLiveMonitorAvailable(true);

        intervalId = globalThis.setInterval(() => {
          if (cancelled || !analyser) return;
          try {
            analyser.getByteTimeDomainData(samples);
          } catch {
            return;
          }

          let sum = 0;
          for (const sample of samples) {
            const normalized = (sample - 128) / 128;
            sum += normalized * normalized;
          }

          const rms = Math.sqrt(sum / samples.length);
          const normalizedLevel = Math.min(1, Math.max(0, (rms - 0.012) / 0.16));
          smoothed = smoothed * 0.68 + normalizedLevel * 0.32;
          const level = smoothed < 0.035 ? 0 : smoothed * 100;
          setMonitorLevel(level);
        }, 70);
      })
      .catch(() => {
        if (!cancelled) setLiveMonitorAvailable(false);
      });

    return stop;
  }, [monitoringEnabled, preferences.monitorInputDeviceId]);

  useEffect(() => {
    if (!monitoringEnabled || liveMonitorAvailable) return;
    setMonitorLevel((current) =>
      Math.abs(rawMonitorLevel - current) < 0.5
        ? rawMonitorLevel
        : current * 0.45 + rawMonitorLevel * 0.55
    );
  }, [liveMonitorAvailable, monitoringEnabled, rawMonitorLevel]);

  useEffect(() => {
    const mediaDevices = globalThis.navigator?.mediaDevices;
    const enumerateDevices = mediaDevices?.enumerateDevices;

    if (typeof enumerateDevices !== "function") return undefined;

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
          new CustomEvent("audio-settings-changed", { detail: updated })
        );
      } catch {}
      return updated;
    }, "Не удалось сохранить аудионастройки");

  const updatePreference = (name, value) => {
    setPreferences(saveAudioPreferences({ [name]: value }));
  };

  const updateNullableDevice = (name, value) => {
    updateBackend({
      [name]: value === "" ? null : Number(value)
    });
  };

  const toggleMonitoring = () =>
    runMonitoringToggle(() =>
      runAudioAction(
        monitoringEnabled
          ? api.stopDirectMonitoring
          : api.startDirectMonitoring,
        "Не удалось изменить прослушивание"
      )
    );
  const DRIVER_OPTIONS = [
    { value: "auto", label: "Авто · Windows / PortAudio" },
    ...(asioDrivers?.length
      ? [{ value: "asio", label: "ASIO · минимальная задержка" }]
      : [])
  ];

  const recordingFields = [
    [
      "Устройство ввода",
      "Микрофон для записи",
      settings?.input_device_id ?? "",
      createIndexedDeviceOptions(devices),
      "input_device_id",
      "nullable-number"
    ],
    [
      "Аудиодрайвер",
      "ASIO даёт минимальную задержку",
      audioDriver,
      DRIVER_OPTIONS,
      "audio_driver",
      "string",
      monitoringEnabled
    ],
    ...(audioDriver === "asio"
      ? [
          [
            "ASIO-драйвер",
            "Нативный драйвер аудиоинтерфейса",
            settings?.asio_driver_name ?? "",
            (asioDrivers ?? []).map(({ name }) => ({
              value: name,
              label: name
            })),
            "asio_driver_name",
            "string",
            monitoringEnabled
          ]
        ]
      : []),
    [
      "Буфер аудио",
      "Меньше буфер — ниже задержка",
      settings?.buffer_size ?? 64,
      createBufferSizeOptions(),
      "buffer_size",
      "number",
      monitoringEnabled
    ]
  ];

  const updateRecordingField = (name, type, value) => {
    const parsers = {
      string: (nextValue) => nextValue,
      number: Number,
      "nullable-number": (nextValue) =>
        nextValue === "" ? null : Number(nextValue)
    };

    updateBackend({
      [name]: parsers[type](value)
    });
  };

  const monitoringFields = [
    [
      "Выход прямого мониторинга",
      "Выход того же аудиоинтерфейса",
      settings?.output_device_id ?? "",
      createIndexedDeviceOptions(outputs, "Системное устройство"),
      "backendDevice",
      "output_device_id"
    ],
    [
      "Вход для прослушивания",
      null,
      preferences.monitorInputDeviceId,
      createBrowserDeviceOptions(browserDevices.inputs, "Микрофон"),
      "preference",
      "monitorInputDeviceId"
    ],
    [
      "Выход для прослушивания",
      null,
      preferences.monitorOutputDeviceId,
      createBrowserDeviceOptions(browserDevices.outputs, "Аудиоустройство"),
      "preference",
      "monitorOutputDeviceId"
    ],
    [
      "Режим задержки",
      null,
      preferences.monitorLatencyHint,
      LATENCY_OPTIONS,
      "preference",
      "monitorLatencyHint"
    ],
    [
      "Режим прослушивания",
      null,
      preferences.monitorMode,
      MONITOR_MODE_OPTIONS,
      "preference",
      "monitorMode"
    ]
  ];

  const handleMonitoringChange = (type, name, value) => {
    if (type === "backendDevice") {
      updateNullableDevice(name, value);
      return;
    }

    updatePreference(name, value);
  };

  return (
    <div className="audio-settings-grid">
      <section className="audio-settings-group u-stack-4">
        <GroupHeader
          icon={Mic2}
          title="Запись и драйвер"
          text="Основное устройство и режим работы аудиосистемы"
        />
        <div className="settings-field-grid">
          {recordingFields.map(
            ([label, hint, value, options, name, type, disabled = false]) => (
              <DropdownField
                key={name}
                label={label}
                hint={hint}
                value={value}
                options={options}
                disabled={disabled}
                onChange={(value) => updateRecordingField(name, type, value)}
              />
            )
          )}
        </div>
      </section>
      <section className="audio-settings-group u-stack-4">
        <GroupHeader
          icon={Headphones}
          title="Прослушивание"
          text="Маршрутизация микрофона и задержка мониторинга"
        />
        <div className="settings-field-grid">
          {monitoringFields.map(([label, hint, value, options, type, name]) => (
            <DropdownField
              key={name}
              label={label}
              hint={hint}
              value={value}
              options={options}
              disabled={monitoringEnabled}
              onChange={(value) => handleMonitoringChange(type, name, value)}
            />
          ))}
          <Field
            label="Уровень микрофона"
            hint="Та же громкость микрофона, что используется в микшере Karaoke"
            variant="card"
          >
            <div className="audio-level-control">
              <RangeInput
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(value) => updateBackend({ volume: value })}
              />

              <strong>{Math.round(volume * 100)}%</strong>
            </div>
          </Field>
        </div>

        <div className="audio-monitor-card">
          <div className="audio-monitor-card__copy">
            <Activity size={18} />

            <div>
              <strong>Прослушивать с этого устройства</strong>
              <small>
                Прослушивание {monitoringEnabled ? "включено" : "выключено"}
              </small>
            </div>
          </div>
          <div
            className="audio-monitor-meter"
            aria-label={`Уровень ${Math.round(monitorLevel)}%`}
          >
            <span style={{ inlineSize: `${monitorLevel}%` }} />
          </div>

          <Button
            variant={monitoringEnabled ? "danger" : "primary"}
            disabled={saving || togglingMonitoring}
            onClick={toggleMonitoring}
          >
            {monitoringEnabled ? "Остановить" : "Прослушивать"}
          </Button>
        </div>
      </section>
    </div>
  );
}
