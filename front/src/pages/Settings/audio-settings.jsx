import { Activity, Headphones, Mic2, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import Dropdown from "../../components/fields/Dropdown";
import Button from "../../components/fields/button";
import Field from "../../components/fields/field";
import RangeInput from "../../components/fields/range-input";
import { useAppDialog } from "../../contexts/AppDialog";
import useAsyncQueue from "../../hooks/useAsyncQueue";
import useExclusiveAsyncAction from "../../hooks/useExclusiveAsyncAction";
import useSpeakingLevels from "../../contexts/hooks/useSpeakingLevels";
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
  const { data: signal } = usePolling(api.getSignalQuality, 80, []);

  const [browserDevices, setBrowserDevices] = useState(EMPTY_BROWSER_DEVICES);
  const [preferences, setPreferences] = useState(getAudioPreferences);
  const [speakerTestState, setSpeakerTestState] = useState("idle");
  const monitorStreamRef = useRef(null);
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
  const audioDriver = runtimeSettings.audioDriver;
  const monitoringEnabled = runtimeSettings.monitoringEnabled;
  const volume = runtimeSettings.volume;
  const rawMonitorLevel = monitoringEnabled ? getSignalLevel(signal) : 0;
  const monitorTargetLevel = monitoringEnabled
    ? Math.max(localSpeakingLevel * 100, rawMonitorLevel)
    : 0;
  const [monitorLevel, setMonitorLevel] = useState(0);
  const monitorTargetRef = useRef(0);
  const monitorPeakHoldUntilRef = useRef(0);

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
    if (!monitoringEnabled) return undefined;

    const intervalId = globalThis.setInterval(() => {
      const target = monitorTargetRef.current;
      const now = performance.now();

      setMonitorLevel((current) => {
        if (target >= current) return Math.min(100, target);
        if (now < monitorPeakHoldUntilRef.current) return current;

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
    if (typeof mediaDevices?.getUserMedia !== "function") return false;

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
      candidates.push({ ...baseAudio, deviceId: { exact: selectedInput } });
    }
    candidates.push(baseAudio);

    let stream = null;
    for (const audio of candidates) {
      try {
        stream = await mediaDevices.getUserMedia({ audio });
        break;
      } catch {
        // Try the default input when a saved browser device id became stale.
      }
    }

    if (!stream) return false;

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
      if (cancelled && started) stopLocalMeter();
    });

    const unlockOnGesture = () => {
      prepareSpeakingMeter();
      if (!monitorStreamRef.current) startLocalMeter();
    };

    globalThis.addEventListener?.("pointerdown", unlockOnGesture, { once: true });
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

  const toggleMonitoring = () => {
    if (!monitoringEnabled) {
      // Must happen synchronously inside the user gesture, otherwise Chromium
      // may keep AudioContext suspended and the analyser will read silence.
      prepareSpeakingMeter();
      void startLocalMeter();
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
    if (speakerTestState === "playing") return;

    const AudioContextClass =
      globalThis.AudioContext || globalThis.webkitAudioContext;

    if (typeof AudioContextClass !== "function") {
      await alert("Не удалось запустить проверку звука: аудиосистема браузера недоступна.");
      return;
    }

    setSpeakerTestState("playing");

    let context;
    let audio;
    try {
      context = new AudioContextClass({ latencyHint: "interactive" });
      if (context.state === "suspended") await context.resume();

      const destination = context.createMediaStreamDestination();
      const gain = context.createGain();
      const oscillator = context.createOscillator();

      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.14, context.currentTime + 0.04);
      gain.gain.setValueAtTime(0.14, context.currentTime + 0.55);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.85);

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

      await new Promise((resolve) => globalThis.setTimeout(resolve, 1050));
      setSpeakerTestState("success");
      globalThis.setTimeout(() => setSpeakerTestState("idle"), 1800);
    } catch (error) {
      setSpeakerTestState("error");
      await alert(`Не удалось проверить динамики: ${getErrorMessage(error)}`);
      globalThis.setTimeout(() => setSpeakerTestState("idle"), 1800);
    } finally {
      try {
        audio?.pause?.();
        audio?.srcObject?.getTracks?.().forEach((track) => track.stop());
      } catch {}
      try {
        await context?.close?.();
      } catch {}
    }
  }, [alert, preferences.monitorOutputDeviceId, speakerTestState]);

  const DRIVER_OPTIONS = [
    { value: "auto", label: "Автоматически · рекомендуется" },
    ...(asioDrivers?.length
      ? [{ value: "asio", label: "ASIO · для аудиоинтерфейсов" }]
      : [])
  ];

  const recordingFields = [
    [
      "Микрофон",
      "С этого устройства будет записываться ваш голос",
      settings?.input_device_id ?? "",
      createIndexedDeviceOptions(devices),
      "input_device_id",
      "nullable-number"
    ],
    [
      "Режим работы звука",
      "Оставьте «Автоматически», если не используете профессиональный аудиоинтерфейс",
      audioDriver,
      DRIVER_OPTIONS,
      "audio_driver",
      "string",
      monitoringEnabled
    ],
    ...(audioDriver === "asio"
      ? [
          [
            "Драйвер аудиоинтерфейса",
            "Выберите фирменный драйвер вашего аудиоинтерфейса",
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
      "Задержка звука",
      "Меньшее значение быстрее передаёт голос, но может сильнее нагружать компьютер",
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
      "Куда выводить голос без задержки",
      "Обычно выбирают наушники или выход того же аудиоинтерфейса",
      settings?.output_device_id ?? "",
      createIndexedDeviceOptions(outputs, "Системное устройство"),
      "backendDevice",
      "output_device_id"
    ],
    [
      "Микрофон для проверки",
      "Используется для индикатора уровня и проверки вашего голоса",
      preferences.monitorInputDeviceId,
      createBrowserDeviceOptions(browserDevices.inputs, "Микрофон"),
      "preference",
      "monitorInputDeviceId"
    ],
    [
      "Динамики или наушники",
      "Сюда будет выводиться звук проверки и прослушивания",
      preferences.monitorOutputDeviceId,
      createBrowserDeviceOptions(browserDevices.outputs, "Аудиоустройство"),
      "preference",
      "monitorOutputDeviceId"
    ],
    [
      "Приоритет воспроизведения",
      "Низкая задержка лучше для пения, стабильный режим — если звук прерывается",
      preferences.monitorLatencyHint,
      LATENCY_OPTIONS,
      "preference",
      "monitorLatencyHint"
    ],
    [
      "Как прослушивать микрофон",
      "Выберите способ, которым приложение будет возвращать ваш голос в наушники",
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
          title="Микрофон и запись"
          text="Выберите микрофон и настройте запись голоса"
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
          title="Проверка звука и прослушивание"
          text="Проверьте микрофон, динамики и при необходимости включите прослушивание своего голоса"
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
            label="Громкость вашего голоса"
            hint="Эта же громкость используется в микшере во время Karaoke"
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

        <div className="audio-monitor-card audio-speaker-test-card">
          <div className="audio-monitor-card__copy">
            <Volume2 size={18} />

            <div>
              <strong>Проверить динамики или наушники</strong>
              <small>
                {speakerTestState === "playing"
                  ? "Воспроизводим тестовый звук…"
                  : speakerTestState === "success"
                    ? "Тестовый звук воспроизведён"
                    : speakerTestState === "error"
                      ? "Проверка не удалась"
                      : "Нажмите кнопку и убедитесь, что слышите короткий сигнал"}
              </small>
            </div>
          </div>

          <Button
            variant="primary"
            disabled={speakerTestState === "playing"}
            onClick={testSpeakers}
          >
            {speakerTestState === "playing" ? "Проверяем…" : "Проверить звук"}
          </Button>
        </div>

        <div className="audio-monitor-card">
          <div className="audio-monitor-card__copy">
            <Activity size={18} />

            <div>
              <strong>Слышать свой голос в наушниках</strong>
              <small>
                Сейчас {monitoringEnabled ? "включено" : "выключено"}. Говорите в микрофон — индикатор ниже покажет уровень
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
            {monitoringEnabled ? "Выключить прослушивание" : "Слышать себя"}
          </Button>
        </div>
      </section>
    </div>
  );
}
