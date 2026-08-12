import { Cpu, Mic2, Palette, Radio, SlidersHorizontal } from "lucide-react";

import { MONITORING_MODES } from "../Karaoke/config";
import screens from "./screens";
import {
  audioDriverVisible,
  audioSelect,
  audioSlider,
  fieldType,
  FORM_FIELDS,
  HALF,
  monitorDisabled,
  multipleAudioDriversAvailable,
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
  ["uk", "Українська"],
  ["ru", "Русский"],
  ["en", "English"]
]);

const THEME_OPTIONS = opts([
  ["dark", "Тёмная"],
  ["light", "Светлая"],
  ["green", "Зелёная"],
  ["violet", "Фиолетовая"]
]);

const COMPUTE_OPTIONS = opts([
  ["auto", "Автоматически · рекомендуется"],
  ["cuda", "NVIDIA CUDA"],
  ["cpu", "Только процессор"]
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

const pickFolder = async (_context, currentPath) => {
  const selectFolder = globalThis.electronAPI?.selectFolder;
  if (typeof selectFolder !== "function") return null;
  return selectFolder(currentPath || undefined);
};

const STORAGE_FIELDS = [
  ["songs_folder", "Песни", "Папка с библиотекой песен"],
  ["ai_folder", "AI-модели", "Папка с локальными AI-моделями"],
  ["cache_folder", "Кэш", "Папка временных файлов"]
].map(([name, label, tooltip]) =>
  FORM_FIELDS.folder(name, {
    label,
    tooltip,
    span: 4,
    save: "change",
    pick: pickFolder,
    browseLabel: `Выбрать папку: ${label}`
  })
);

/* =========================================================
   AUDIO

   Основные настройки показываются сразу.
   Технические параметры, которые обычно корректно выбираются
   автоматически, помечены advanced и открываются по запросу.
   ========================================================= */

const AUDIO_SELECT_FIELDS = [
  [
    "input_device_id",
    "inputDevices",
    "Микрофон",
    "Устройство для записи голоса",
    {
      span: 4,
      startIcon: Mic2,
      parse: "nullable-number"
    }
  ],
  [
    "output_device_id",
    "outputDevices",
    "Динамики или наушники",
    "Куда выводить звук приложения",
    {
      span: 8,
      parse: "nullable-number"
    }
  ],
  [
    "audio_driver",
    "audioDrivers",
    "Режим звука",
    "Автоматический режим подходит большинству пользователей",
    {
      advanced: true,
      isVisible: multipleAudioDriversAvailable
    }
  ],
  [
    "asio_driver_name",
    "asioDrivers",
    "ASIO-драйвер",
    "Нужен только при ручном использовании ASIO",
    {
      advanced: true,
      isVisible: audioDriverVisible
    }
  ],
  [
    "buffer_size",
    "bufferSizes",
    "Буфер аудио",
    "Меньше — ниже задержка, но выше нагрузка и риск щелчков",
    {
      advanced: true,
      parse: "number"
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
    "Отдельный микрофон только для браузерного индикатора уровня"
  ],
  [
    "monitorOutputDeviceId",
    "browserOutputs",
    "Выход для проверки",
    "Отдельное устройство только для тестового сигнала"
  ],
  [
    "monitorLatencyHint",
    LATENCY_OPTIONS,
    "Режим задержки",
    "Автоматического режима достаточно в большинстве случаев"
  ],
  [
    "monitorMode",
    MONITOR_MODE_OPTIONS,
    "Режим прослушивания",
    "Способ возврата голоса в наушники"
  ]
].map(([name, source, label, tooltip]) =>
  preferenceSelect(name, source, {
    label,
    tooltip,
    advanced: true,
    isDisabled: monitorDisabled
  })
);

const AUDIO_SPECIAL_FIELDS = [
  [
    "action",
    "speakerTest",
    4,
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
    3,
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

const [MICROPHONE_FIELD, OUTPUT_FIELD, ...ADVANCED_AUDIO_FIELDS] =
  AUDIO_SELECT_FIELDS;

const VOICE_VOLUME_FIELD = audioSlider("volume", {
  span: 5,
  label: "Громкость голоса",
  tooltip: "Громкость вашего голоса при прослушивании",
  min: 0,
  max: 1,
  step: 0.05,
  getLabel: percent("Громкость голоса")
});

const AUDIO_FIELDS = [
  OUTPUT_FIELD,
  AUDIO_SPECIAL_FIELDS[0],
  MICROPHONE_FIELD,
  VOICE_VOLUME_FIELD,
  AUDIO_SPECIAL_FIELDS[1],
  ...ADVANCED_AUDIO_FIELDS,
  ...PREFERENCE_FIELDS
];

/* =========================================================
   AI
   ========================================================= */

const AI_SETTINGS_FIELDS = [
  [
    "select",
    "compute_mode",
    "Устройство обработки",
    "Автоматический режим использует NVIDIA CUDA при наличии и CPU на остальных компьютерах",
    {
      options: COMPUTE_OPTIONS
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
