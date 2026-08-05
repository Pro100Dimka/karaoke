import { FolderX, Sparkles } from "lucide-react";
import { api } from "../../../../api/client";
import { formatBytes } from "./format";

export const DEFAULT_OPTIMIZE_OPTION = {
  value: "",
  label: "Оптимизировать файлы песни..."
};
export const MEMORY_SECTIONS = [
  ["full_songs", "Песни (оригиналы)"],
  ["song_results", "Результаты AI"],
  ["database", "База данных"]
];

export const MEMORY_ACTIONS = [
  [
    "clear-cache",
    "Очистить кэш",
    Sparkles,
    "primary",
    api.clearCache,
    ({ freed_bytes: freedBytes }) => `Освобождено: ${formatBytes(freedBytes)}`
  ],
  [
    "delete-temp",
    "Удалить временные файлы",
    FolderX,
    "ghost",
    api.deleteTemp,
    ({ freed_bytes: freedBytes }) =>
      `Удалено временных файлов: ${formatBytes(freedBytes)}`
  ]
];

export const buildOptimizeOptions = (songs = []) => [
  DEFAULT_OPTIMIZE_OPTION,
  ...songs
    .filter(({ status, optimized }) => status === "done" && !optimized)
    .map(({ id: value, title: label }) => ({ value, label }))
];
