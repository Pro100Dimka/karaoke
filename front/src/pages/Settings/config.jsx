import {
  Check,
  Cpu,
  FolderCog,
  Mic2,
  Palette,
  Radio,
  Save,
  SlidersHorizontal,
  Wrench
} from "lucide-react";

import { MONITORING_MODES } from "../Karaoke/config";
import screens from "./screens";

const option = (value, label = value) => ({
  value,
  label
});

export const LATENCY_OPTIONS = [
  ["interactive", "Низкая задержка"],
  ["balanced", "Автоматический"],
  ["playback", "Стабильное воспроизведение"]
].map(([value, label]) => ({
  value,
  label
}));

export const MONITOR_MODE_OPTIONS = MONITORING_MODES.map(({ id, title }) => ({
  value: id,
  label: title
}));

export const SETTINGS = {
  appearance: {
    label: "Интерфейс",
    icon: Palette,
    className: "settings-field-grid",

    fields: [
      {
        type: "select",
        source: "form",
        name: "language",

        label: "Язык",
        tooltip: "Язык интерфейса приложения",

        options: [option("ru", "Русский"), option("en", "English")]
      },

      {
        type: "select",
        source: "form",
        name: "theme",

        label: "Тема",
        tooltip: "Цветовое оформление приложения",

        save: "change",

        options: [
          option("dark", "Тёмная"),
          option("light", "Светлая"),
          option("green", "Зелёная"),
          option("violet", "Фиолетовая")
        ]
      },

      {
        type: "text",
        source: "form",
        name: "online_name",

        label: "Имя в сети",
        tooltip: "Это имя увидят другие участники комнаты",

        placeholder: "Например, Дима",
        maxLength: 40,

        save: "blur"
      },

      {
        type: "select",
        source: "radio",
        name: "stationId",

        label: "Радиостанция",
        tooltip: "Выберите фоновую музыку",

        startIcon: Radio,
        options: "stations",

        fieldSx: {
          flex: 3,
          minWidth: 0
        }
      },

      {
        type: "slider",
        source: "radio",
        name: "volume",

        label: "Громкость",
        tooltip: "Громкость фоновой музыки",

        min: 0,
        max: 1,
        step: 0.01,

        formatLabel: (value) =>
          `Громкость · ${Math.round((value ?? 0) * 100)}%`,

        fieldSx: {
          flex: 2,
          minWidth: 0
        }
      }
    ]
  },

  audio: {
    label: "Звук",
    icon: SlidersHorizontal,
    className: "settings-field-grid",

    fields: [
      {
        type: "select",
        source: "audio",
        name: "input_device_id",

        label: "Микрофон",
        tooltip: "Устройство для записи голоса",

        startIcon: Mic2,
        options: "inputDevices",
        parse: "nullable-number"
      },

      {
        type: "select",
        source: "audio",
        name: "audio_driver",

        label: "Режим звука",
        tooltip: "Автоматический режим подходит большинству пользователей",

        options: "audioDrivers",
        disabledWhen: "monitoringEnabled"
      },

      {
        type: "select",
        source: "audio",
        name: "asio_driver_name",

        label: "Аудиодрайвер",
        tooltip: "Драйвер вашего аудиоинтерфейса",

        options: "asioDrivers",

        visibleWhen: {
          field: "audio_driver",
          equals: "asio"
        },

        disabledWhen: "monitoringEnabled"
      },

      {
        type: "select",
        source: "audio",
        name: "buffer_size",

        label: "Задержка",
        tooltip: "Меньше — быстрее отклик, но выше нагрузка",

        options: "bufferSizes",
        parse: "number",

        disabledWhen: "monitoringEnabled"
      },

      {
        type: "select",
        source: "audio",
        name: "output_device_id",

        label: "Выход голоса",
        tooltip: "Куда выводить голос при прослушивании",

        options: "outputDevices",
        parse: "nullable-number",

        disabledWhen: "monitoringEnabled"
      },

      {
        type: "select",
        source: "audioPreference",
        name: "monitorInputDeviceId",

        label: "Микрофон для проверки",
        tooltip: "Используется для проверки уровня голоса",

        options: "browserInputs",

        disabledWhen: "monitoringEnabled"
      },

      {
        type: "select",
        source: "audioPreference",
        name: "monitorOutputDeviceId",

        label: "Динамики или наушники",
        tooltip: "Устройство для проверки звука",

        options: "browserOutputs",

        disabledWhen: "monitoringEnabled"
      },

      {
        type: "select",
        source: "audioPreference",
        name: "monitorLatencyHint",

        label: "Задержка воспроизведения",
        tooltip: "Низкая задержка лучше подходит для пения",

        options: LATENCY_OPTIONS,

        disabledWhen: "monitoringEnabled"
      },

      {
        type: "select",
        source: "audioPreference",
        name: "monitorMode",

        label: "Прослушивание микрофона",
        tooltip: "Как возвращать ваш голос в наушники",

        options: MONITOR_MODE_OPTIONS,

        disabledWhen: "monitoringEnabled"
      },

      {
        type: "slider",
        source: "audio",
        name: "volume",

        label: "Громкость голоса",
        tooltip: "Громкость вашего голоса при прослушивании",

        min: 0,
        max: 1,
        step: 0.05,

        formatLabel: (value) =>
          `Громкость голоса · ${Math.round((value ?? 0) * 100)}%`
      },

      {
        type: "action",
        source: "audio",
        name: "speakerTest",

        label: "Проверить звук",
        tooltip: "Воспроизвести короткий тестовый сигнал",

        action: "testSpeakers",

        idleText: "Проверить звук",
        pendingText: "Проверяем…"
      },

      {
        type: "monitor",
        source: "audio",
        name: "monitoringEnabled",

        label: "Слышать свой голос",
        tooltip: "Включить прямое прослушивание микрофона",

        action: "toggleMonitoring",
        level: "monitorLevel"
      }
    ]
  },

  ai: {
    label: "Обработка",
    icon: Cpu,
    className: "settings-field-grid",

    fields: [
      {
        type: "select",
        source: "form",
        name: "whisper_model",

        label: "Распознавание текста",
        tooltip: "Выберите баланс скорости и точности",

        options: [
          option("tiny", "Очень быстро"),
          option("base", "Быстро"),
          option("small", "Сбалансировано"),
          option("medium", "Точно"),
          option("large", "Максимальная точность"),
          option("turbo", "Быстро и точно"),
          option("large-v3-turbo", "Рекомендуется")
        ]
      },

      {
        type: "number",
        source: "form",
        name: "thread_count",

        label: "Потоки процессора",
        tooltip: "Больше потоков обычно ускоряет обработку",

        min: 1,
        max: 64,

        parse: "number"
      },

      {
        type: "toggle",
        source: "form",
        name: "use_gpu",

        label: "Использовать видеокарту",
        tooltip: "Ускоряет обработку"
      },

      {
        type: "toggle",
        source: "form",
        name: "use_cpu",

        label: "Использовать процессор",
        tooltip: "Используется, если видеокарта недоступна"
      }
    ]
  },

  storage: {
    label: "Файлы",
    icon: FolderCog,
    className: "settings-field-grid settings-path-grid",

    fields: [
      {
        type: "readonly",
        source: "form",
        name: "songs_folder",
        label: "Песни"
      },

      {
        type: "readonly",
        source: "form",
        name: "ai_folder",
        label: "Обработанные файлы"
      },

      {
        type: "readonly",
        source: "form",
        name: "cache_folder",
        label: "Кэш"
      }
    ]
  },

  service: {
    label: "Дополнительно",
    icon: Wrench,
    className: "settings-service-grid",
    screens
  }
};

export const SETTINGS_TABS = Object.entries(SETTINGS).map(
  ([id, { label, icon }]) => ({
    id,
    label,
    icon
  })
);

export const SCREEN_BY_ID = Object.fromEntries(
  screens.map((screen) => [screen.id, screen])
);

export const SAVE_BUTTONS = {
  idle: {
    text: "Сохранить",
    Icon: Save
  },

  saving: {
    text: "Сохраняем…",
    Icon: Save
  },

  saved: {
    text: "Сохранено",
    Icon: Check
  }
};

export const EMPTY_BROWSER_DEVICES = Object.freeze({
  inputs: [],
  outputs: []
});
