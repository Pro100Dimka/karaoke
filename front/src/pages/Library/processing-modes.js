export const DEFAULT_PROCESSING_MODE = "auto";
const MODES = new Set([DEFAULT_PROCESSING_MODE, "fast", "quality"]);

export const normalizeProcessingMode = (value) =>
  MODES.has(value) ? value : DEFAULT_PROCESSING_MODE;
