import { SETTINGS_TABS } from "../config";
import About from "./About";
import Diagnostics from "./Diagnostics";
import History from "./History";
import MemoryManager from "./MemoryManager";
import ModelManager from "./ModelManager";

export default [
  {
    id: "models",
    title: "Модели AI",
    text: "Загрузка и выбор моделей распознавания",
    component: ModelManager
  },
  {
    id: "memory",
    title: "Хранилище",
    text: "Кэш, свободное место и очистка",
    component: MemoryManager
  },
  {
    id: "history",
    title: "История",
    text: "События и действия в приложении",
    component: History
  },
  {
    id: "diagnostics",
    title: "Диагностика",
    text: "Проверка компонентов и окружения",
    component: Diagnostics
  },
  {
    id: "about",
    title: "О программе",
    text: "Версия и сведения о приложении",
    component: About
  }
];
export const SettingsTabs = ({ value, onChange }) => {
  return (
    <nav className="settings-tabs" aria-label="Разделы настроек">
      {SETTINGS_TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={value === id ? "is-active" : ""}
          onClick={() => onChange(id)}
        >
          <Icon size={17} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
};
