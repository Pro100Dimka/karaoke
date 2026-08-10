import { Cpu, Mic2, Palette, Radio, SlidersHorizontal } from "lucide-react";

import { MONITORING_MODES } from "../Karaoke/config";
import screens from "./screens";
import {
  audioDriverVisible,
  audioSelect,
  audioSlider,
  fieldType,
  FORM_FIELDS,
  formReadonly,
  HALF,
  monitorDisabled,
  opts,
  percent,
  preferenceSelect,
  radioField,
  speakerPlaying
} from "./utils";

export const FULL = 12;

export const LATENCY_OPTIONS = opts([
  ["interactive", "Низкая задержка"],
  ["balanced", "Автоматический"],
  ["playback", "Стабильное воспроизведение"]
]);

export const MONITOR_MODE_OPTIONS = MONITORING_MODES.map(({ id, title }) => ({
  value: id,
  label: title
}));

const LANGUAGE_OPTIONS = opts([
  ["ru", "Русский"],
  ["en", "English"]
]);

const THEME_OPTIONS = opts([
  ["dark", "Тёмная"],
  ["light", "Светлая"],
  ["green", "Зелёная"],
  ["violet", "Фиолетовая"]
]);

const WHISPER_OPTIONS = opts([
  ["tiny", "Очень быстро"],
  ["base", "Быстро"],
  ["small", "Сбалансировано"],
  ["medium", "Точно"],
  ["large", "Максимальная точность"],
  ["turbo", "Быстро и точно"],
  ["large-v3-turbo", "Рекомендуется"]
]);

/* =========================================================
   GENERAL
   ========================================================= */

const GENERAL_FORM_FIELDS = [
  [
    "text",
    "online_name",
    "Имя в сети",
    "Это имя увидят другие участники комнаты",
    {
      span: 4,
      placeholder: "Например, Дима",
      maxLength: 40,
      save: "blur"
    }
  ],

  [
    "select",
    "language",
    "Язык",
    "Язык интерфейса приложения",
    {
      span: 4,
      options: LANGUAGE_OPTIONS
    }
  ],

  [
    "select",
    "theme",
    "Тема",
    "Цветовое оформление приложения",
    {
      span: 4,
      options: THEME_OPTIONS,
      save: "change"
    }
  ]
].map(([type, name, label, tooltip, extra = {}]) =>
  FORM_FIELDS[type](name, {
    label,
    tooltip,
    ...extra
  })
);

const RADIO_FIELDS = [
  [
    "select",
    "stationId",
    "Радиостанция",
    "Выберите фоновую музыку",
    {
      span: HALF,
      startIcon: Radio,

      getOptions: ({ radio }) =>
        (radio?.stations ?? []).map(({ id, name, description }) => ({
          value: id,
          label: name,
          description
        }))
    }
  ],

  [
    "slider",
    "volume",
    "Громкость",
    "Громкость фоновой музыки",
    {
      span: HALF,
      min: 0,
      max: 1,
      step: 0.01,

      getLabel: percent("Громкость")
    }
  ]
].map(([type, name, label, tooltip, extra = {}]) =>
  fieldType(radioField, type)(name, {
    label,
    tooltip,
    ...extra
  })
);

const GENERAL_FIELDS = [...GENERAL_FORM_FIELDS, ...RADIO_FIELDS];

/* =========================================================
   STORAGE
   ========================================================= */

const STORAGE_FIELDS = [
  ["songs_folder", "Песни"],

  ["ai_folder", "Обработанные файлы"],

  ["cache_folder", "Кэш"]
].map(([name, label]) =>
  formReadonly(name, {
    label,
    span: 4
  })
);

/* =========================================================
   AUDIO
   ========================================================= */

const AUDIO_SELECT_FIELDS = [
  [
    "input_device_id",
    "inputDevices",
    "Микрофон",
    "Устройство для записи голоса",
    {
      startIcon: Mic2,
      parse: "nullable-number"
    }
  ],

  [
    "audio_driver",
    "audioDrivers",
    "Режим звука",
    "Автоматический режим подходит большинству пользователей"
  ],

  [
    "asio_driver_name",
    "asioDrivers",
    "Аудиодрайвер",
    "Драйвер вашего аудиоинтерфейса",
    {
      isVisible: audioDriverVisible
    }
  ],

  [
    "buffer_size",
    "bufferSizes",
    "Задержка",
    "Меньше — быстрее отклик, но выше нагрузка",
    {
      parse: "number"
    }
  ],

  [
    "output_device_id",
    "outputDevices",
    "Выход голоса",
    "Куда выводить голос при прослушивании",
    {
      parse: "nullable-number"
    }
  ]
].map(([name, source, label, tooltip, extra = {}]) =>
  audioSelect(name, source, {
    label,
    tooltip,
    isDisabled: monitorDisabled,
    ...extra
  })
);

const PREFERENCE_FIELDS = [
  [
    "monitorInputDeviceId",
    "browserInputs",
    "Микрофон для проверки",
    "Используется для проверки уровня голоса"
  ],

  [
    "monitorOutputDeviceId",
    "browserOutputs",
    "Динамики или наушники",
    "Устройство для проверки звука"
  ],

  [
    "monitorLatencyHint",
    LATENCY_OPTIONS,
    "Задержка воспроизведения",
    "Низкая задержка лучше подходит для пения"
  ],

  [
    "monitorMode",
    MONITOR_MODE_OPTIONS,
    "Прослушивание микрофона",
    "Как возвращать ваш голос в наушники"
  ]
].map(([name, source, label, tooltip]) =>
  preferenceSelect(name, source, {
    label,
    tooltip,
    isDisabled: monitorDisabled
  })
);

const AUDIO_SPECIAL_FIELDS = [
  [
    "action",
    "speakerTest",
    HALF,
    "Проверить звук",
    "Воспроизвести короткий тестовый сигнал",
    {
      idleText: "Проверить звук",

      pendingText: "Проверяем…",

      isPending: speakerPlaying,

      isDisabled: speakerPlaying,

      run: ({ audio }) => audio.actions?.testSpeakers?.()
    }
  ],

  [
    "monitor",
    "monitoringEnabled",
    FULL,
    "Слышать свой голос",
    "Включить прямое прослушивание микрофона",
    {
      getValue: ({ audio }) => audio.states?.monitoringEnabled,

      getLevel: ({ audio }) => audio.states?.monitorLevel ?? 0,

      isDisabled: ({ audio }) =>
        audio.states?.saving || audio.states?.togglingMonitoring,

      run: ({ audio }) => audio.actions?.toggleMonitoring?.()
    }
  ]
].map(([type, name, span, label, tooltip, extra = {}]) => ({
  type,
  name,
  span,
  label,
  tooltip,
  ...extra
}));

const AUDIO_FIELDS = [
  ...AUDIO_SELECT_FIELDS,
  ...PREFERENCE_FIELDS,

  audioSlider("volume", {
    label: "Громкость голоса",

    tooltip: "Громкость вашего голоса при прослушивании",

    min: 0,
    max: 1,
    step: 0.05,

    getLabel: percent("Громкость голоса")
  }),

  ...AUDIO_SPECIAL_FIELDS
];

/* =========================================================
   AI
   ========================================================= */

const AI_SETTINGS_FIELDS = [
  [
    "select",
    "whisper_model",
    "Распознавание текста",
    "Выберите баланс скорости и точности",
    {
      options: WHISPER_OPTIONS
    }
  ],

  [
    "number",
    "thread_count",
    "Потоки процессора",
    "Больше потоков обычно ускоряет обработку",
    {
      min: 1,
      max: 64,
      parse: "number"
    }
  ],

  ["toggle", "use_gpu", "Использовать видеокарту", "Ускоряет обработку"],

  [
    "toggle",
    "use_cpu",
    "Использовать процессор",
    "Используется, если видеокарта недоступна"
  ]
].map(([type, name, label, tooltip, extra = {}]) =>
  FORM_FIELDS[type](name, {
    label,
    tooltip,
    ...extra
  })
);

const AI_FIELDS = [...AI_SETTINGS_FIELDS, ...STORAGE_FIELDS];

/* =========================================================
   SETTINGS
   ========================================================= */

export const SETTINGS = Object.fromEntries(
  [
    ["appearance", "Общее", Palette, GENERAL_FIELDS],

    ["audio", "Звук", SlidersHorizontal, AUDIO_FIELDS],

    ["ai", "Обработка", Cpu, AI_FIELDS]
  ].map(([id, label, icon, fields]) => [
    id,
    {
      label,
      icon,
      fields
    }
  ])
);

export const SERVICE_SCREENS = screens;

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

export const EMPTY_BROWSER_DEVICES = Object.freeze({
  inputs: [],
  outputs: []
});
