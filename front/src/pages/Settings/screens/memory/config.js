import { FolderX, Sparkles } from "lucide-react";
import { api } from "../../../../api/client";
import { translateSaved } from "../../../../i18n/runtime";
import { formatBytes } from "./format";

export const DEFAULT_OPTIMIZE_OPTION = {
  value: "",
  label: translateSaved("Оптимизировать файлы песни...")
};
export const MEMORY_SECTIONS = [
  ["karaoke_songs", translateSaved("Песни и результаты обработки")],
  ["database", translateSaved("База данных")]
];
export const MEMORY_ACTIONS = [
  [
    "clear-cache",
    translateSaved("Очистить кэш"),
    Sparkles,
    "primary",
    api.clearCache,
    ({ freed_bytes: freedBytes }) =>
      translateSaved("Освобождено: {0}", { 0: formatBytes(freedBytes) })
  ],
  [
    "delete-temp",
    translateSaved("Удалить временные файлы"),
    FolderX,
    "ghost",
    api.deleteTemp,
    ({ freed_bytes: freedBytes }) =>
      translateSaved("Удалено временных файлов: {0}", { 0: formatBytes(freedBytes) })
  ]
];
export function buildOptimizeOptions(songs = []) {
  return [
    DEFAULT_OPTIMIZE_OPTION,
    ...songs
      .filter(({ status, optimized }) => status === "done" && !optimized)
      .map(({ id: value, title: label }) => ({ value, label }))
  ];
}
