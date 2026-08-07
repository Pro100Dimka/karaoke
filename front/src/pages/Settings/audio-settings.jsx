import { Activity, Headphones, Mic2 } from "lucide-react";
import { useEffect, useState } from "react";
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

function getSignalLevel(rmsDb) {
  const db = Number(rmsDb);

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
  const { data: signal } = usePolling(api.getSignalQuality, 1200, []);

  const [browserDevices, setBrowserDevices] = useState(EMPTY_BROWSER_DEVICES);
  const [preferences, setPreferences] = useState(getAudioPreferences);

  const { pending: saving, run: enqueueAudioUpdate } = useAsyncQueue();
  const { pending: togglingMonitoring, run: runMonitoringToggle } =
    useExclusiveAsyncAction();

  const runtimeSettings = normalizeAudioRuntimeSettings(settings);
  const audioDriver = runtimeSettings.audioDriver;
  const monitoringEnabled = runtimeSettings.monitoringEnabled;
  const volume = runtimeSettings.volume;
  const level = getSignalLevel(signal?.rms_db);

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
    runAudioAction(
      () => api.updateAudioSettings(patch),
      "Не удалось сохранить аудионастройки"
    );

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
            hint="Громкость записи и мониторинга"
            variant="card"
          >
            <div className="audio-level-control">
              <RangeInput
                min="0"
                max="4"
                step="0.05"
                value={volume}
                onChange={(value) => updateBackend({ volume: value })}
              />

              <strong>{Math.round((volume / 4) * 100)}%</strong>
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
            aria-label={`Уровень ${Math.round(level)}%`}
          >
            <span style={{ inlineSize: `${level}%` }} />
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
