import { translateSaved as t } from "../../../../i18n/runtime";

export const MIXER_FIELDS = [
  ["microphone", t("karaoke.mick"), "var(--color-primary)"],
  ["music", t("karaoke.music"), "var(--color-success)"],
  ["vocal", t("karaoke.vocals"), "var(--color-warning)"],
  ["melody", t("karaoke.melody"), "var(--color-secondary)"]
];
export const EFFECT_FIELDS = [
  ["echo", t("karaoke.echo")],
  ["reverb", t("karaoke.reverb"), "secondary"],
  ["delay", t("karaoke.delay")],
  ["noise_suppression", t("karaoke.noise")]
];
