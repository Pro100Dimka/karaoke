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
import AudioSettings from "./audio-settings";
import RadioSettings from "./radio-settings";
import screens from "./screens";

const option = (value, label = value) => ({ value, label });

export const SETTINGS = {
  audio: {
    label: "Аудио и запись",
    icon: SlidersHorizontal,
    component: AudioSettings
  },
  radio: {
    label: "Радио",
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
        hint: "Язык элементов приложения",
        options: [option("ru", "Русский"), option("en", "English")]
      },
      {
        type: "select",
        variant: "card",
        name: "theme",
        label: "Тема",
        hint: "Применяется сразу, без перезапуска",
        options: [
          option("dark", "Тёмная"),
          option("light", "Светлая"),
          option("green", "Зеленая")
        ]
      },

      {
        type: "text",
        variant: "card",
        name: "online_name",
        label: "Имя для онлайн-комнат",
        hint: "Его увидят другие участники совместного исполнения",
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
    label: "AI и обработка",
    icon: Cpu,
    className: "settings-field-grid",
    fields: [
      {
        type: "select",
        variant: "card",
        name: "whisper_model",
        label: "Модель Whisper",
        hint: "Качество распознавания текста",
        options: "tiny,base,small,medium,large,turbo,large-v3-turbo"
          .split(",")
          .map(option)
      },
      {
        type: "number",
        variant: "card",
        name: "thread_count",
        label: "Потоки CPU",
        hint: "Больше потоков — быстрее обработка",
        min: 1,
        max: 64
      },
      {
        type: "toggle",
        variant: "switch-card",
        name: "use_gpu",
        label: "Использовать GPU",
        hint: "Ускоряет AI, если видеокарта поддерживается"
      },
      {
        type: "toggle",
        variant: "switch-card",
        name: "use_cpu",
        label: "Использовать CPU",
        hint: "Резервный режим обработки"
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
        variant: "card",
        name: "songs_folder",
        label: "Папка с песнями"
      },
      {
        type: "readonly",
        variant: "card",
        name: "ai_folder",
        label: "Папка AI"
      },
      {
        type: "readonly",
        variant: "card",
        name: "recordings_folder",
        label: "Папка записей"
      },
      {
        type: "readonly",
        variant: "card",
        name: "cache_folder",
        label: "Папка кэша"
      }
    ]
  },
  service: {
    label: "Обслуживание",
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
export {
  EMPTY_BROWSER_DEVICES,
  LATENCY_OPTIONS,
  MONITOR_MODE_OPTIONS
} from "./audio-options";
