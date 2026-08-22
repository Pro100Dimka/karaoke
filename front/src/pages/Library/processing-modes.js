import { translateSaved as tr } from "../../i18n/runtime";

export const DEFAULT_PROCESSING_MODE = "auto";
const MODES = new Set([DEFAULT_PROCESSING_MODE, "fast", "quality"]);

export const normalizeProcessingMode = (value) =>
  MODES.has(value) ? value : DEFAULT_PROCESSING_MODE;

export const getProcessingModeOptions = () =>
  [
    ["auto", tr("Авто · баланс"), tr("Средняя скорость и качество с учётом вашего железа")],
    [
      "fast",
      tr("Быстрый · минимальное время"),
      tr("Минимальный overlap и один проход очистки вокала")
    ],
    [
      "quality",
      tr("Качество · точное разделение"),
      tr("Четырёхкратный overlap и усиленная очистка вокала")
    ]
  ].map(([value, label, description]) => ({ value, label, description }));
