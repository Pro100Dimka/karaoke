import { translateSaved as tr } from "../i18n/runtime";

export const AIModes = [
  {
    value: "auto",
    label: tr("library.autoBalanced"),
    description: tr("library.balancedSpeedAndQualityForYourHardware")
  },
  {
    value: "fast",
    label: tr("library.fastMinimumTime"),
    description: tr("library.minimumOverlapAndOneVocalCleanupPass")
  },
  {
    value: "quality",
    label: tr("library.qualityPreciseSeparation"),
    description: tr("library.fourfoldOverlapAndEnhancedVocalCleanup")
  }
];
