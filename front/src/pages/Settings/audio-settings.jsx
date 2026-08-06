import { Activity, Headphones, Mic2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import Dropdown from "../../components/fields/Dropdown";
import RangeInput from "../../components/fields/range-input";
import Field from "../../components/fields/field";
import Button from "../../components/fields/button";
import { useAppDialog } from "../../contexts/AppDialog";
import useAsyncQueue from "../../hooks/useAsyncQueue";
import useExclusiveAsyncAction from "../../hooks/useExclusiveAsyncAction";
import { usePolling } from "../../hooks/usePolling";
import { getErrorMessage } from "../../utils/errors";
import {
  getAudioPreferences,
  saveAudioPreferences
} from "../../utils/audio-preferences";
import { MONITORING_MODES } from "../Karaoke/config";
import { groupBrowserAudioDevices } from "../Karaoke/utils/audio-settings";
import {
  createBrowserDeviceOptions,
  createBufferSizeOptions,
  createIndexedDeviceOptions
} from "../Karaoke/utils/devices";

const LATENCY_OPTIONS = [
  { value: "interactive", label: "Низкая задержка" },
  { value: "balanced", label: "Автоматический" },
  { value: "playback", label: "Стабильное воспроизведение" }
];

const MONITOR_MODE_OPTIONS = MONITORING_MODES.map(({ id, title }) => ({
  value: id,
  label: title
}));

export default function AudioSettings() {
  const { alert } = useAppDialog();
  const { data: settings, refresh } = usePolling(api.getAudioSettings, 15000, []);
  const { data: devices } = usePolling(api.listAudioDevices, 30000, []);
  const { data: outputs } = usePolling(api.listAudioOutputDevices, 30000, []);
  const { data: asioDrivers } = usePolling(api.listAsioDrivers, 30000, []);
  const { data: signal } = usePolling(api.getSignalQuality, 1200, []);
  const [browserDevices, setBrowserDevices] = useState({ inputs: [], outputs: [] });
  const [preferences, setPreferences] = useState(getAudioPreferences);
  const { pending: saving, run: enqueueAudioUpdate } = useAsyncQueue();
  const { pending: togglingMonitoring, run: runMonitoringToggle } =
    useExclusiveAsyncAction();

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return undefined;

    let active = true;
    navigator.mediaDevices
      .enumerateDevices()
      .then((entries) => {
        if (active) setBrowserDevices(groupBrowserAudioDevices(entries));
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const audioDriver = settings?.audio_driver || "auto";
  const monitoringEnabled = Boolean(settings?.monitoring_enabled);
  const level = useMemo(() => {
    const db = Number(signal?.rms_db);
    if (!Number.isFinite(db)) return 0;
    return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  }, [signal?.rms_db]);

  const updateBackend = (patch) =>
    enqueueAudioUpdate(async () => {
      try {
        await api.updateAudioSettings(patch);
        await refresh?.();
      } catch (error) {
        await alert(
          `Не удалось сохранить аудионастройки: ${getErrorMessage(error)}`
        );
      }
    });

  const updatePreference = (name, value) => {
    const next = saveAudioPreferences({ [name]: value });
    setPreferences(next);
  };

  const toggleMonitoring = () =>
    runMonitoringToggle(() =>
      enqueueAudioUpdate(async () => {
        try {
          if (monitoringEnabled) await api.stopDirectMonitoring();
          else await api.startDirectMonitoring();
          await refresh?.();
        } catch (error) {
          await alert(
            `Не удалось изменить прослушивание: ${getErrorMessage(error)}`
          );
        }
      })
    );

  return (
    <div className="audio-settings-grid">
      <section className="audio-settings-group u-stack-4">
        <header className="audio-settings-group__header">
          <Mic2 size={18} />
          <div>
            <strong>Запись и драйвер</strong>
            <small>Основное устройство и режим работы аудиосистемы</small>
          </div>
        </header>

        <div className="settings-field-grid">
          <Field label="Устройство ввода" hint="Микрофон для записи" variant="card">
            <Dropdown
              value={settings?.input_device_id ?? ""}
              options={createIndexedDeviceOptions(devices)}
              onChange={(value) =>
                updateBackend({ input_device_id: value === "" ? null : Number(value) })
              }
            />
          </Field>

          <Field label="Аудиодрайвер" hint="ASIO даёт минимальную задержку" variant="card">
            <Dropdown
              value={audioDriver}
              disabled={monitoringEnabled}
              options={[
                { value: "auto", label: "Авто · Windows / PortAudio" },
                ...((asioDrivers || []).length
                  ? [{ value: "asio", label: "ASIO · минимальная задержка" }]
                  : [])
              ]}
              onChange={(value) => updateBackend({ audio_driver: value })}
            />
          </Field>

          {audioDriver === "asio" && (
            <Field label="ASIO-драйвер" hint="Нативный драйвер аудиоинтерфейса" variant="card">
              <Dropdown
                value={settings?.asio_driver_name ?? ""}
                disabled={monitoringEnabled}
                options={(asioDrivers || []).map((driver) => ({
                  value: driver.name,
                  label: driver.name
                }))}
                onChange={(value) => updateBackend({ asio_driver_name: value })}
              />
            </Field>
          )}

          <Field label="Буфер аудио" hint="Меньше буфер — ниже задержка" variant="card">
            <Dropdown
              value={settings?.buffer_size ?? 64}
              disabled={monitoringEnabled}
              options={createBufferSizeOptions()}
              onChange={(value) => updateBackend({ buffer_size: Number(value) })}
            />
          </Field>
        </div>
      </section>

      <section className="audio-settings-group u-stack-4">
        <header className="audio-settings-group__header">
          <Headphones size={18} />
          <div>
            <strong>Прослушивание</strong>
            <small>Маршрутизация микрофона и задержка мониторинга</small>
          </div>
        </header>

        <div className="settings-field-grid">
          <Field label="Выход прямого мониторинга" hint="Выход того же аудиоинтерфейса" variant="card">
            <Dropdown
              value={settings?.output_device_id ?? ""}
              disabled={monitoringEnabled}
              options={createIndexedDeviceOptions(outputs, "Системное устройство")}
              onChange={(value) =>
                updateBackend({ output_device_id: value === "" ? null : Number(value) })
              }
            />
          </Field>

          <Field label="Вход для прослушивания" variant="card">
            <Dropdown
              value={preferences.monitorInputDeviceId}
              disabled={monitoringEnabled}
              options={createBrowserDeviceOptions(browserDevices.inputs, "Микрофон")}
              onChange={(value) => updatePreference("monitorInputDeviceId", value)}
            />
          </Field>

          <Field label="Выход для прослушивания" variant="card">
            <Dropdown
              value={preferences.monitorOutputDeviceId}
              disabled={monitoringEnabled}
              options={createBrowserDeviceOptions(browserDevices.outputs, "Аудиоустройство")}
              onChange={(value) => updatePreference("monitorOutputDeviceId", value)}
            />
          </Field>

          <Field label="Режим задержки" variant="card">
            <Dropdown
              value={preferences.monitorLatencyHint}
              disabled={monitoringEnabled}
              options={LATENCY_OPTIONS}
              onChange={(value) => updatePreference("monitorLatencyHint", value)}
            />
          </Field>

          <Field label="Режим прослушивания" variant="card">
            <Dropdown
              value={preferences.monitorMode}
              disabled={monitoringEnabled}
              options={MONITOR_MODE_OPTIONS}
              onChange={(value) => updatePreference("monitorMode", value)}
            />
          </Field>

          <Field label="Уровень микрофона" hint="Громкость записи и мониторинга" variant="card">
            <div className="audio-level-control">
              <RangeInput
                min="0"
                max="4"
                step="0.05"
                value={settings?.volume ?? 1}
                onChange={(volume) => updateBackend({ volume })}
              />
              <strong>{Math.round(((settings?.volume ?? 1) / 4) * 100)}%</strong>
            </div>
          </Field>
        </div>

        <div className="audio-monitor-card">
          <div className="audio-monitor-card__copy">
            <Activity size={18} />
            <div>
              <strong>Прослушивать с этого устройства</strong>
              <small>{monitoringEnabled ? "Прослушивание включено" : "Прослушивание выключено"}</small>
            </div>
          </div>
          <div className="audio-monitor-meter" aria-label={`Уровень ${Math.round(level)}%`}>
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
