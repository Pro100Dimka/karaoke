import { Cpu, Mic2, Palette, Radio, SlidersHorizontal } from "lucide-react";
import { translateSaved } from "../../i18n/runtime";
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
const LANGUAGE_OPTIONS = opts([
  ["uk", translateSaved("Українська")],
  ["ru", translateSaved("Русский")],
  ["en", "English"]
]);
const THEME_OPTIONS = opts([
  ["dark", translateSaved("Тёмная")],
  ["light", translateSaved("Светлая")],
  ["green", translateSaved("Зелёная")],
  ["violet", translateSaved("Фиолетовая")]
]);
const COMPUTE_OPTIONS = opts([
  ["auto", translateSaved("Автоматически · рекомендуется")],
  ["cuda", "NVIDIA CUDA"],
  ["cpu", translateSaved("Только процессор")]
]);

/* =========================================================
   GENERAL
   ========================================================= */

const GENERAL_FORM_FIELDS = [
  [
    "text",
    "online_name",
    translateSaved("Имя в сети"),
    translateSaved("Это имя увидят другие участники комнаты"),
    { span: 4, placeholder: translateSaved("Например, Дима"), maxLength: 40, save: "blur" }
  ],
  [
    "select",
    "language",
    translateSaved("Язык"),
    translateSaved("Язык интерфейса приложения"),
    { span: 4, options: LANGUAGE_OPTIONS }
  ],
  [
    "select",
    "theme",
    translateSaved("Тема"),
    translateSaved("Цветовое оформление приложения"),
    { span: 4, options: THEME_OPTIONS, save: "change" }
  ]
].map(([type, name, label, tooltip, extra = {}]) =>
  FORM_FIELDS[type](name, { label, tooltip, ...extra })
);
const RADIO_FIELDS = [
  [
    "select",
    "stationId",
    translateSaved("Радиостанция"),
    translateSaved("Выберите фоновую музыку"),
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
    translateSaved("Громкость"),
    translateSaved("Громкость фоновой музыки"),
    { span: HALF, min: 0, max: 1, step: 0.01, getLabel: percent(translateSaved("Громкость")) }
  ]
].map(([type, name, label, tooltip, extra = {}]) =>
  fieldType(radioField, type)(name, { label, tooltip, ...extra })
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
  [ "songs_folder", translateSaved("Песни"), translateSaved("Папка с библиотекой песен") ],
  [ "ai_folder", translateSaved("AI-модели"), translateSaved("Папка с локальными AI-моделями") ],
  [ "cache_folder", translateSaved("Кэш"), translateSaved("Папка временных файлов") ]
].map(([name, label, tooltip]) =>
  FORM_FIELDS.folder(name, {
    label,
    tooltip,
    span: 4,
    save: "change",
    pick: pickFolder,
    browseLabel: translateSaved("Выбрать папку: {0}", { 0: label })
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
    translateSaved("Микрофон"),
    translateSaved("Устройство для записи голоса"),
    { span: 4, startIcon: Mic2, parse: "nullable-number" }
  ],
  [
    "output_device_id",
    "outputDevices",
    translateSaved("Динамики или наушники"),
    translateSaved("Куда выводить звук приложения"),
    { span: 8, parse: "nullable-number" }
  ],
  [
    "audio_driver",
    "audioDrivers",
    translateSaved("Режим звука"),
    translateSaved("Автоматический режим подходит большинству пользователей"),
    { advanced: true, isVisible: multipleAudioDriversAvailable }
  ],
  [
    "asio_driver_name",
    "asioDrivers",
    translateSaved("ASIO-драйвер"),
    translateSaved("Нужен только при ручном использовании ASIO"),
    { advanced: true, isVisible: audioDriverVisible }
  ],
  [
    "buffer_size",
    "bufferSizes",
    translateSaved("Буфер аудио"),
    translateSaved("Меньше — ниже задержка, но выше нагрузка и риск щелчков"),
    { advanced: true, parse: "number" }
  ]
].map(([name, source, label, tooltip, extra = {}]) =>
  audioSelect(name, source, { label, tooltip, isDisabled: monitorDisabled, ...extra })
);
const PREFERENCE_FIELDS = [
  [
    "monitorInputDeviceId",
    "browserInputs",
    translateSaved("Микрофон для проверки"),
    translateSaved( "Отдельный микрофон только для браузерного индикатора уровня"
    )
  ],
  [
    "monitorOutputDeviceId",
    "browserOutputs",
    translateSaved("Выход для проверки"),
    translateSaved("Отдельное устройство только для тестового сигнала")
  ]
].map(([name, source, label, tooltip]) =>
  preferenceSelect(name, source, { label, tooltip, advanced: true, isDisabled: monitorDisabled })
);
const AUDIO_SPECIAL_FIELDS = [
  [
    "action",
    "speakerTest",
    4,
    translateSaved("Проверить звук"),
    translateSaved("Воспроизвести короткий тестовый сигнал"),
    {
      idleText: translateSaved("Проверить звук"),
      pendingText: translateSaved("Проверяем…"),
      isPending: speakerPlaying,
      isDisabled: speakerPlaying,
      run: ({ audio }) => audio.actions?.testSpeakers?.()
    }
  ],
  [
    "monitor",
    "monitoringEnabled",
    3,
    translateSaved("Слышать свой голос"),
    translateSaved("Включить прямое прослушивание микрофона"),
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
  label: translateSaved("Громкость голоса"),
  tooltip: translateSaved("Громкость вашего голоса при прослушивании"),
  min: 0,
  max: 1,
  step: 0.05,
  getLabel: percent(translateSaved("Громкость голоса"))
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
    translateSaved("Устройство обработки"),
    translateSaved(
      "Автоматический режим использует NVIDIA CUDA при наличии и CPU на остальных компьютерах"
    ),
    { options: COMPUTE_OPTIONS }
  ],
  [
    "number",
    "thread_count",
    translateSaved("Потоки процессора"),
    translateSaved("Больше потоков обычно ускоряет обработку"),
    { min: 1, max: 64, parse: "number" }
  ]
].map(([type, name, label, tooltip, extra = {}]) =>
  FORM_FIELDS[type](name, { label, tooltip, ...extra })
);
const AI_FIELDS = [...AI_SETTINGS_FIELDS, ...STORAGE_FIELDS];

/* =========================================================
   SETTINGS
   ========================================================= */

export const SETTINGS = {
  appearance: { label: translateSaved("Общее"), icon: Palette, fields: GENERAL_FIELDS },
  audio: { label: translateSaved("Звук"), icon: SlidersHorizontal, fields: AUDIO_FIELDS },
  ai: { label: translateSaved("Обработка"), icon: Cpu, fields: AI_FIELDS }
};
export const SERVICE_SCREENS = screens;
export const SETTINGS_TABS = Object.entries(SETTINGS).map(
  ([id, { label, icon }]) => ({ id, label, icon })
);
export const SCREEN_BY_ID = Object.fromEntries( screens.map((screen) => [screen.id, screen])
);
export const EMPTY_BROWSER_DEVICES = Object.freeze({ inputs: [], outputs: [] });
