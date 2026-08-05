import { CheckCircle2, Download, Trash2 } from "lucide-react";
import { api } from "../../../../api/client";

export const BYTES_IN_MB = 1024 ** 2;

export const MODEL_COLUMNS = [
  ["name", "Модель"],
  ["size", "Размер"],
  ["status", "Статус"],
  ["actions", "", "models-actions-column"]
];

export const STATUSES = [
  {
    id: "selected",
    check: ({ selected }) => selected,
    className: "badge badge-done",
    text: "Выбрана"
  },
  {
    id: "downloaded",
    check: ({ downloaded }) => downloaded,
    className: "badge badge-pending",
    text: "Скачана"
  },
  {
    id: "missing",
    check: () => true,
    className: "models-status-missing text-muted",
    text: "Не скачана"
  }
];
export const ACTIONS = [
  {
    id: "download",
    label: "Скачать",
    icon: Download,
    variant: "primary",
    visible: ({ downloaded }) => !downloaded,
    request: api.downloadModel
  },
  {
    id: "select",
    label: "Выбрать",
    icon: CheckCircle2,
    variant: "ghost",
    visible: ({ downloaded, selected }) => downloaded && !selected,
    request: api.selectModel
  },
  {
    id: "remove",
    label: null,
    ariaLabel: "Удалить модель",
    icon: Trash2,
    variant: "danger",
    visible: ({ downloaded }) => downloaded,
    confirm: ({ name }) => `Удалить модель ${name}?`,
    request: api.deleteModel
  }
];
