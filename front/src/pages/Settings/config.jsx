import {
  Cpu,
  FolderCog,
  Mic2,
  Palette,
  Radio,
  SlidersHorizontal,
  Wrench
} from "lucide-react";
import { MONITORING_MODES } from "../Karaoke/config";
import screens from "./screens";
import {
  audioDriverVisible,
  audioSelect,
  audioSlider,
  fieldType,
  FORM_FIELDS,
  formReadonly,
  monitorDisabled,
  opts,
  percent,
  preferenceSelect,
  radioField,
  speakerPlaying
} from "./utils";

export const HALF = 6;
export const FULL = 12;

export const radioActions = { stationId: "setStation", volume: "setVolume" };

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
   APPEARANCE
   ========================================================= */

const APPEARANCE_FIELDS = [
  ...[
    [
      "select",
      "language",
      "Язык",
      "Язык интерфейса приложения",
      {
        options: LANGUAGE_OPTIONS
      }
    ],

    [
      "select",
      "theme",
      "Тема",
      "Цветовое оформление приложения",
      {
        options: THEME_OPTIONS,
        save: "change"
      }
    ],

    [
      "text",
      "online_name",
      "Имя в сети",
      "Это имя увидят другие участники комнаты",
      {
        placeholder: "Например, Дима",
        maxLength: 40,
        save: "blur"
      }
    ]
  ].map(([type, name, label, tooltip, extra = {}]) =>
    FORM_FIELDS[type](name, {
      label,
      tooltip,
      ...extra
    })
  ),

  ...[
    [
      "select",
      "stationId",
      "Радиостанция",
      "Выберите фоновую музыку",
      {
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
        min: 0,
        max: 1,
        step: 0.01,
        getLabel: percent("Громкость")
      }
    ]
  ].map(([type, name, label, tooltip, extra = {}]) =>
    fieldType(radioField, type)(name, { label, tooltip, ...extra })
  )
];

/* =========================================================
   AUDIO SELECTS
   ========================================================= */

const AUDIO_SELECT_FIELDS = [
  [
    "input_device_id",
    "inputDevices",
    "Микрофон",
    "Устройство для записи голоса",
    { startIcon: Mic2, parse: "nullable-number" }
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
    { isVisible: audioDriverVisible }
  ],
  [
    "buffer_size",
    "bufferSizes",
    "Задержка",
    "Меньше — быстрее отклик, но выше нагрузка",
    { parse: "number" }
  ],
  [
    "output_device_id",
    "outputDevices",
    "Выход голоса",
    "Куда выводить голос при прослушивании",
    { parse: "nullable-number" }
  ]
].map(([name, source, label, tooltip, extra = {}]) =>
  audioSelect(name, source, {
    label,
    tooltip,
    isDisabled: monitorDisabled,
    ...extra
  })
);

/* =========================================================
   AUDIO PREFERENCES
   ========================================================= */

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

/* =========================================================
   AUDIO SPECIAL FIELDS
   ========================================================= */

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

/* =========================================================
   AUDIO
   ========================================================= */

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

const AI_FIELDS = [
  [
    "select",
    "whisper_model",
    "Распознавание текста",
    "Выберите баланс скорости и точности",
    { options: WHISPER_OPTIONS }
  ],
  [
    "number",
    "thread_count",
    "Потоки процессора",
    "Больше потоков обычно ускоряет обработку",
    { min: 1, max: 64, parse: "number" }
  ],
  ["toggle", "use_gpu", "Использовать видеокарту", "Ускоряет обработку"],
  [
    "toggle",
    "use_cpu",
    "Использовать процессор",
    "Используется, если видеокарта недоступна"
  ]
].map(([type, name, label, tooltip, extra = {}]) =>
  FORM_FIELDS[type](name, { label, tooltip, ...extra })
);

/* =========================================================
   STORAGE
   ========================================================= */

const STORAGE_FIELDS = [
  ["songs_folder", "Песни"],
  ["ai_folder", "Обработанные файлы"],
  ["cache_folder", "Кэш"]
].map(([name, label]) => formReadonly(name, { label }));

/* =========================================================
   SETTINGS
   ========================================================= */

export const SETTINGS = Object.fromEntries(
  [
    ["appearance", "Интерфейс", Palette, APPEARANCE_FIELDS],
    ["audio", "Звук", SlidersHorizontal, AUDIO_FIELDS],
    ["ai", "Обработка", Cpu, AI_FIELDS],
    [
      "storage",
      "Файлы",
      FolderCog,
      STORAGE_FIELDS,
      { className: "settings-path-grid" }
    ],
    ["service", "Дополнительно", Wrench, null, { screens }]
  ].map(([id, label, icon, fields, extra = {}]) => [
    id,
    { label, icon, ...(fields ? { fields } : {}), ...extra }
  ])
);

/* =========================================================
   DERIVED CONFIG
   ========================================================= */

export const SETTINGS_TABS = Object.entries(SETTINGS).map(
  ([id, { label, icon }]) => ({ id, label, icon })
);

export const SCREEN_BY_ID = Object.fromEntries(
  screens.map((screen) => [screen.id, screen])
);

export const EMPTY_BROWSER_DEVICES = Object.freeze({ inputs: [], outputs: [] });
