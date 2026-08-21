import { translateSaved } from "../../i18n/runtime";

export const DEFAULT_PROCESSING_MODE = "auto";
const PROCESSING_MODES = new Set(["auto", "fast", "quality"]);

export function normalizeProcessingMode(value) {
  return PROCESSING_MODES.has(value) ? value : DEFAULT_PROCESSING_MODE;
}

export function getProcessingModeOptions() {
  return [
    { value: "auto", label: translateSaved("Авто · быстро для этого компьютера") },
    { value: "fast", label: translateSaved("Быстрый · минимальное время") },
    { value: "quality", label: translateSaved("Качество · точнее разделение") }
  ];
}
