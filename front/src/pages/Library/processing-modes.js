import { translateSaved as tr } from "../../i18n/runtime";

export const DEFAULT_PROCESSING_MODE = "auto";
const MODES = new Set([DEFAULT_PROCESSING_MODE, "fast", "quality"]);

export const normalizeProcessingMode = (value) =>
  MODES.has(value) ? value : DEFAULT_PROCESSING_MODE;

export const getProcessingModeOptions = () =>
  [
    ["auto", tr("library.autoBalanced"), tr("library.balancedSpeedAndQualityForYourHardware")],
    ["fast", tr("library.fastMinimumTime"), tr("library.minimumOverlapAndOneVocalCleanupPass")],
    [
      "quality",
      tr("library.qualityPreciseSeparation"),
      tr("library.fourfoldOverlapAndEnhancedVocalCleanup")
    ]
  ].map(([value, label, description]) => ({ value, label, description }));
