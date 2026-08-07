import About from "./about";
import Diagnostics from "./diagnostics";
import History from "./history";
import MemoryManager from "./memory";
import Models from "./models";

export default [
  {
    id: "models",
    title: "Модели распознавания",
    text: "Скачать или выбрать модель, которая распознаёт слова песни",
    component: Models
  },
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
