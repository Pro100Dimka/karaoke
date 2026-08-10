import About from "./about";
import Diagnostics from "./diagnostics";
import History from "./history";
import MemoryManager from "./memory";

export default [
  {
    id: "memory",
    title: "Освободить место",
    text: "Посмотреть, что занимает место, и удалить ненужные временные файлы",
    component: MemoryManager
  },
  {
    id: "history",
    title: "История действий",
    text: "Посмотреть последние действия и события приложения",
    component: History
  },
  {
    id: "diagnostics",
    title: "Проверка приложения",
    text: "Проверить, всё ли готово для обработки песен и записи",
    component: Diagnostics
  },
  {
    id: "about",
    title: "О программе",
    text: "Версия приложения и техническая информация",
    component: About
  }
];
