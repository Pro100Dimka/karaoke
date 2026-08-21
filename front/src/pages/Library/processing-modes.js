import { translateSaved } from "../../i18n/runtime";

export const DEFAULT_PROCESSING_MODE = "auto";
const PROCESSING_MODES = new Set(["auto", "fast", "quality"]);

export function normalizeProcessingMode(value) {
  return PROCESSING_MODES.has(value) ? value : DEFAULT_PROCESSING_MODE;
}

export function getProcessingModeOptions() {
  return [
    {
      value: "auto",
      label: translateSaved("Авто · баланс"),
      description: translateSaved("Средняя скорость и качество с учётом вашего железа")
    },
    {
      value: "fast",
      label: translateSaved("Быстрый · минимальное время"),
      description: translateSaved("Минимальный overlap и один проход очистки вокала")
    },
    {
      value: "quality",
      label: translateSaved("Качество · точное разделение"),
      description: translateSaved("Четырёхкратный overlap и усиленная очистка вокала")
    }
  ];
}
