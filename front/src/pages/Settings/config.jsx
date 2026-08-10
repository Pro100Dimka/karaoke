import {
  Check,
  Cpu,
  FolderCog,
  Palette,
  Radio,
  Save,
  SlidersHorizontal,
  Wrench
} from "lucide-react";
import { MONITORING_MODES } from "../Karaoke/config";
import AudioSettings from "./audio-settings";
import RadioSettings from "./radio-settings";
import screens from "./screens";

const option = (value, label = value) => ({ value, label });

export const SETTINGS = {
  audio: {
    label: "Звук и микрофон",
    icon: SlidersHorizontal,
    component: AudioSettings
  },
  radio: {
    label: "Фоновая музыка",
    icon: Radio,
    component: RadioSettings
  },
  appearance: {
    label: "Интерфейс",
    icon: Palette,
    className: "settings-field-grid",
    fields: [
      {
        type: "select",
        variant: "card",
        name: "language",
        label: "Язык интерфейса",
        hint: "На каком языке будут показаны кнопки, подсказки и меню",
        options: [option("ru", "Русский"), option("en", "English")]
      },
      {
        type: "select",
        variant: "card",
        name: "theme",
        label: "Тема",
        hint: "Изменения применяются сразу и сохраняются автоматически",
        saveOnChange: true,
        options: [
          option("dark", "Тёмная"),
          option("light", "Светлая"),
          option("green", "Зеленая"),
          option("violet", "Фиолетовая")
        ]
      },

      {
        type: "text",
        variant: "card",
        name: "online_name",
        label: "Ваше имя в онлайн-комнатах",
        hint: "Это имя увидят другие участники комнаты",
        placeholder: "Например, Дима",
        maxLength: 40,
        saveOnBlur: true
      }
      // НЕ УДАЛЯТЬ
      // {
      //   type: "toggle",
      //   variant: "switch-card",
      //   name: "autosave",
      //   label: "Автосохранение",
      //   hint: "Сохранять изменения автоматически"
      // },
      // {
      //   type: "toggle",
      //   variant: "switch-card",
      //   name: "autoupdate",
      //   label: "Автообновление",
      //   hint: "Проверять новые версии приложения"
      // }
    ]
  },

  ai: {
    label: "Обработка песен",
    icon: Cpu,
    className: "settings-field-grid",
    fields: [
      {
        type: "select",
        variant: "card",
        name: "whisper_model",
        label: "Точность распознавания слов",
        hint: "Более точная модель лучше распознаёт слова, но дольше обрабатывает песню",
        options: [
          option("tiny", "Очень быстро · минимальная точность"),
          option("base", "Быстро · базовая точность"),
          option("small", "Баланс скорости и точности"),
          option("medium", "Высокая точность"),
          option("large", "Максимальная точность · медленнее"),
          option("turbo", "Очень быстро · хорошая точность"),
          option("large-v3-turbo", "Рекомендуется · быстро и точно")
        ]
      },
      {
        type: "number",
        variant: "card",
        name: "thread_count",
        label: "Потоки процессора",
        hint: "Сколько ресурсов процессора можно использовать. Больше — обычно быстрее",
        min: 1,
        max: 64
      },
      {
        type: "toggle",
        variant: "switch-card",
        name: "use_gpu",
        label: "Использовать видеокарту",
        hint: "Заметно ускоряет обработку на совместимых видеокартах"
      },
      {
        type: "toggle",
        variant: "switch-card",
        name: "use_cpu",
        label: "Разрешить обработку на процессоре",
        hint: "Использовать процессор, если видеокарта недоступна или не подходит"
      }
    ]
  },
  storage: {
    label: "Папки и файлы",
    icon: FolderCog,
    className: "settings-field-grid settings-path-grid",
    fields: [
      {
        type: "readonly",
        variant: "card",
        name: "songs_folder",
        label: "Где хранятся песни"
      },
      {
        type: "readonly",
        variant: "card",
        name: "ai_folder",
        label: "Файлы обработки песен"
      },
      {
        type: "readonly",
        variant: "card",
        name: "cache_folder",
        label: "Временные файлы"
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
  idle: { text: "Сохранить изменения", Icon: Save },
  saving: { text: "Сохраняем…", Icon: Save },
  saved: { text: "Сохранено", Icon: Check }
};
export const LATENCY_OPTIONS = [
  ["interactive", "Низкая задержка"],
  ["balanced", "Автоматический"],
  ["playback", "Стабильное воспроизведение"]
].map(([value, label]) => ({ value, label }));

export const MONITOR_MODE_OPTIONS = MONITORING_MODES.map(({ id, title }) => ({
  value: id,
  label: title
}));

export const EMPTY_BROWSER_DEVICES = Object.freeze({
  inputs: [],
  outputs: []
});
