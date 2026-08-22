import { Cpu, Palette, SlidersHorizontal, Wrench } from "lucide-react";
import { translateSaved as tr } from "../../i18n/runtime";

const options = (items) => items.map(([value, label]) => ({ value, label }));
const field = (source, type, name, label, tooltip, extra = {}) => ({
  source,
  type,
  name,
  span: 1,
  label,
  tooltip,
  ...extra
});

export const TABS = [
  ["appearance", tr("Общее"), Palette],
  ["audio", tr("Звук"), SlidersHorizontal],
  ["ai", tr("Обработка"), Cpu],
  ["advanced", tr("Дополнительно"), Wrench]
];

export const FIELDS = {
  appearance: [
    field(
      "app",
      "text",
      "online_name",
      tr("Имя в сети"),
      tr("Это имя увидят другие участники комнаты"),
      {
        placeholder: tr("Например, Дима"),
        maxLength: 40,
        save: "blur"
      }
    ),
    field("app", "select", "language", tr("Язык"), tr("Язык интерфейса приложения"), {
      save: "change",
      options: options([
        ["uk", tr("Українська")],
        ["ru", tr("Русский")],
        ["en", "English"]
      ])
    }),
    field("app", "select", "theme", tr("Тема"), tr("Цветовое оформление приложения"), {
      save: "change",
      options: options([
        ["dark", tr("Тёмная")],
        ["light", tr("Светлая")],
        ["green", tr("Зелёная")],
        ["violet", tr("Фиолетовая")]
      ])
    }),
    field("radio", "toggle", "enabled", tr("Включить радио"), tr("Фоновая музыка"), {
      checkedText: tr("Включено"),
      uncheckedText: tr("Выключено")
    }),
    field("radio", "select", "stationId", tr("Радиостанция"), tr("Выберите фоновую музыку"), {
      optionsKey: "stations"
    }),
    field("radio", "slider", "volume", tr("Громкость"), tr("Громкость фоновой музыки"), {
      min: 0,
      max: 1,
      step: 0.01,
      percent: true
    })
  ],
  audio: [
    field(
      "audio",
      "select",
      "output_device_id",
      tr("Динамики или наушники"),
      tr("Куда выводить звук"),
      {
        optionsKey: "outputs",
        parse: "nullable-number"
      }
    ),
    field(
      "audio",
      "select",
      "input_device_id",
      tr("Микрофон"),
      tr("Устройство для записи голоса"),
      {
        optionsKey: "inputs",
        parse: "nullable-number"
      }
    ),
    field(
      "audio",
      "speaker",
      "speakerTest",
      tr("Проверить динамики"),
      tr("Воспроизвести тестовый сигнал")
    ),
    field(
      "audio",
      "monitor",
      "monitoring_enabled",
      tr("Мониторинг микрофона"),
      tr("Прямое прослушивание без эффектов")
    ),
    field(
      "audio",
      "slider",
      "volume",
      tr("Громкость голоса"),
      tr("Громкость прямого прослушивания"),
      {
        min: 0,
        max: 2,
        step: 0.05,
        percent: true
      }
    ),
    field(
      "audio",
      "slider",
      "noise_suppression",
      tr("Подавление шума"),
      tr("Убирает постоянный фоновый шум"),
      {
        min: 0,
        max: 1,
        step: 0.05,
        percent: true
      }
    )
  ],
  ai: [
    field(
      "app",
      "select",
      "compute_mode",
      tr("Устройство обработки"),
      tr("Выбор CPU или NVIDIA CUDA"),
      {
        span: 3,
        save: "change",
        options: options([
          ["auto", tr("Автоматически · рекомендуется")],
          ["cuda", "NVIDIA CUDA"],
          ["cpu", tr("Только процессор")]
        ])
      }
    ),
    field(
      "app",
      "number",
      "thread_count",
      tr("Потоки процессора"),
      tr("Количество потоков обработки"),
      {
        span: 3,
        min: 1,
        max: 64,
        parse: "number",
        save: "blur"
      }
    ),
    ...[
      ["songs_folder", tr("Песни"), tr("Папка с библиотекой песен")],
      ["ai_folder", tr("AI-модели"), tr("Папка с локальными AI-моделями")],
      ["cache_folder", tr("Кэш"), tr("Папка временных файлов")]
    ].map(([name, label, tooltip]) =>
      field("app", "folder", name, label, tooltip, {
        span: name === "cache_folder" ? 6 : 3,
        save: "blur",
        browseLabel: tr("Выбрать папку: {0}", { 0: label })
      })
    )
  ],
  advanced: []
};

export const SERVICES = ["memory", "history", "diagnostics", "about"];
