import { Check, Cpu, FolderCog, Palette, Save, Wrench } from "lucide-react";
import screens from "./screens";

const option = (value, label = value) => ({ value, label });

export const SETTINGS = {
  appearance: {
    label: "Интерфейс",
    icon: Palette,
    className: "settings-field-grid",
    fields: [
      {
        type: "select",
        name: "language",
        label: "Язык интерфейса",
        hint: "Язык элементов приложения",
        options: [option("ru", "Русский"), option("en", "English")]
      },
      {
        type: "select",
        name: "theme",
        label: "Тема",
        hint: "Применяется сразу, без перезапуска",
        options: [option("dark", "Тёмная"), option("light", "Светлая")]
      },
      {
        type: "text",
        name: "online_name",
        label: "Имя для онлайн-комнат",
        hint: "Его увидят другие участники совместного исполнения",
        placeholder: "Например, Дима",
        maxLength: 40,
        saveOnBlur: true
      },
      {
        type: "toggle",
        name: "autosave",
        label: "Автосохранение",
        hint: "Сохранять изменения автоматически"
      },
      {
        type: "toggle",
        name: "autoupdate",
        label: "Автообновление",
        hint: "Проверять новые версии приложения"
      }
    ]
  },
  ai: {
    label: "AI и обработка",
    icon: Cpu,
    className: "settings-field-grid",
    fields: [
      {
        type: "select",
        name: "whisper_model",
        label: "Модель Whisper",
        hint: "Качество распознавания текста",
        options: "tiny,base,small,medium,large,turbo,large-v3-turbo"
          .split(",")
          .map(option)
      },
      {
        type: "number",
        name: "thread_count",
        label: "Потоки CPU",
        hint: "Больше потоков — быстрее обработка",
        min: 1,
        max: 64
      },
      {
        type: "toggle",
        name: "use_gpu",
        label: "Использовать GPU",
        hint: "Ускоряет AI, если видеокарта поддерживается"
      },
      {
        type: "toggle",
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
      { type: "readonly", name: "songs_folder", label: "Папка с песнями" },
      { type: "readonly", name: "ai_folder", label: "Папка AI" },
      { type: "readonly", name: "recordings_folder", label: "Папка записей" },
      { type: "readonly", name: "cache_folder", label: "Папка кэша" }
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
export const SETTINGS_TAB_BY_ID = Object.fromEntries(
  SETTINGS_TABS.map((tab) => [tab.id, tab])
);
export const SCREEN_BY_ID = Object.fromEntries(
  screens.map((screen) => [screen.id, screen])
);
export const SAVE_BUTTONS = {
  idle: { text: "Сохранить изменения", Icon: Save },
  saving: { text: "Сохраняем…", Icon: Save },
  saved: { text: "Сохранено", Icon: Check }
};
