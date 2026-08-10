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

const HALF = 6;
const FULL = 12;

const opts = (items) =>
  items.map(([value, label]) => ({
    value,
    label
  }));

const percent =
  (label) =>
  ({ value }) =>
    `${label} · ${Math.round((value ?? 0) * 100)}%`;

const createField =
  ({ get, set, save }) =>
  (name, config = {}) => ({
    name,
    span: HALF,
    getValue: get?.(name),
    setValue: set?.(name),
    saveValue: save?.(name),
    ...config
  });

const formField = createField({
  get:
    (name) =>
    ({ form }) =>
      form?.[name],

  set:
    (name) =>
    ({ onChange }, value) =>
      onChange(name, value),

  save:
    (name) =>
    ({ onFieldBlur }, value) =>
      onFieldBlur(name, value)
});

const radioActions = {
  stationId: "setStation",
  volume: "setVolume"
};

const radioField = createField({
  get:
    (name) =>
    ({ radio }) =>
      radio?.[name],

  set:
    (name) =>
    ({ radio }, value) =>
      radio?.[radioActions[name]]?.(value)
});

const audioField = createField({
  get:
    (name) =>
    ({ audio }) =>
      audio.values?.[name],

  set:
    (name) =>
    ({ audio }, value) =>
      audio.updateBackend({
        [name]: value
      })
});

const preferenceField = createField({
  get:
    (name) =>
    ({ audio }) =>
      audio.preferences?.[name],

  set:
    (name) =>
    ({ audio }, value) =>
      audio.updatePreference(name, value)
});

const fieldType =
  (factory, type) =>
  (name, config = {}) =>
    factory(name, {
      type,
      ...config
    });

const formSelect = fieldType(formField, "select");
const formToggle = fieldType(formField, "toggle");
const formNumber = fieldType(formField, "number");
const formReadonly = fieldType(formField, "readonly");

const radioSelect = fieldType(radioField, "select");
const radioSlider = fieldType(radioField, "slider");

const audioSlider = fieldType(audioField, "slider");

const audioOption =
  (name) =>
  ({ audio }) =>
    audio.options?.[name] ?? [];

const selectFrom =
  (factory) =>
  (name, source, config = {}) =>
    factory(name, {
      type: "select",

      ...(typeof source === "string"
        ? {
            getOptions: audioOption(source)
          }
        : {
            options: source
          }),

      ...config
    });

const audioSelect = selectFrom(audioField);

const preferenceSelect = selectFrom(preferenceField);

const monitorDisabled = ({ audio }) => Boolean(audio.states?.monitoringEnabled);

const audioDriverVisible = ({ audio }) => audio.values?.audio_driver === "asio";

const speakerPlaying = ({ audio }) =>
  audio.states?.speakerTestState === "playing";

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
  formSelect("language", {
    label: "Язык",
    tooltip: "Язык интерфейса приложения",
    options: LANGUAGE_OPTIONS
  }),

  formSelect("theme", {
    label: "Тема",
    tooltip: "Цветовое оформление приложения",
    options: THEME_OPTIONS,
    save: "change"
  }),

  formField("online_name", {
    type: "text",
    label: "Имя в сети",
    tooltip: "Это имя увидят другие участники комнаты",
    placeholder: "Например, Дима",
    maxLength: 40,
    save: "blur"
  }),

  radioSelect("stationId", {
    label: "Радиостанция",
    tooltip: "Выберите фоновую музыку",
    startIcon: Radio,

    getOptions: ({ radio }) =>
      (radio?.stations ?? []).map(({ id, name, description }) => ({
        value: id,
        label: name,
        description
      }))
  }),

  radioSlider("volume", {
    label: "Громкость",
    tooltip: "Громкость фоновой музыки",

    min: 0,
    max: 1,
    step: 0.01,

    getLabel: percent("Громкость")
  })
];

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

  {
    type: "action",
    name: "speakerTest",
    span: HALF,

    label: "Проверить звук",
    tooltip: "Воспроизвести короткий тестовый сигнал",

    idleText: "Проверить звук",

    pendingText: "Проверяем…",

    isPending: speakerPlaying,

    isDisabled: speakerPlaying,

    run: ({ audio }) => audio.actions?.testSpeakers?.()
  },

  {
    type: "monitor",
    name: "monitoringEnabled",
    span: FULL,

    label: "Слышать свой голос",

    tooltip: "Включить прямое прослушивание микрофона",

    getValue: ({ audio }) => audio.states?.monitoringEnabled,

    getLevel: ({ audio }) => audio.states?.monitorLevel ?? 0,

    isDisabled: ({ audio }) =>
      audio.states?.saving || audio.states?.togglingMonitoring,

    run: ({ audio }) => audio.actions?.toggleMonitoring?.()
  }
];

/* =========================================================
   AI
   ========================================================= */

const AI_FIELDS = [
  formSelect("whisper_model", {
    label: "Распознавание текста",

    tooltip: "Выберите баланс скорости и точности",

    options: WHISPER_OPTIONS
  }),

  formNumber("thread_count", {
    label: "Потоки процессора",

    tooltip: "Больше потоков обычно ускоряет обработку",

    min: 1,
    max: 64,
    parse: "number"
  }),

  ...[
    ["use_gpu", "Использовать видеокарту", "Ускоряет обработку"],

    [
      "use_cpu",
      "Использовать процессор",
      "Используется, если видеокарта недоступна"
    ]
  ].map(([name, label, tooltip]) =>
    formToggle(name, {
      label,
      tooltip
    })
  )
];

/* =========================================================
   STORAGE
   ========================================================= */

const STORAGE_FIELDS = [
  ["songs_folder", "Песни"],

  ["ai_folder", "Обработанные файлы"],

  ["cache_folder", "Кэш"]
].map(([name, label]) =>
  formReadonly(name, {
    label
  })
);

/* =========================================================
   SETTINGS
   ========================================================= */

export const SETTINGS = {
  appearance: {
    label: "Интерфейс",
    icon: Palette,
    fields: APPEARANCE_FIELDS
  },

  audio: {
    label: "Звук",
    icon: SlidersHorizontal,
    fields: AUDIO_FIELDS
  },

  ai: {
    label: "Обработка",
    icon: Cpu,
    fields: AI_FIELDS
  },

  storage: {
    label: "Файлы",
    icon: FolderCog,

    className: "settings-path-grid",

    fields: STORAGE_FIELDS
  },

  service: {
    label: "Дополнительно",
    icon: Wrench,
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

export const EMPTY_BROWSER_DEVICES = Object.freeze({
  inputs: [],
  outputs: []
});
