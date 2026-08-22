import { translateSaved as t } from "../../../../i18n/runtime";

export const MIXER_FIELDS = [
  ["microphone", t("Мик"), "var(--color-primary)"],
  ["music", t("Музыка"), "var(--color-success)"],
  ["vocal", t("Вокал"), "var(--color-warning)"],
  ["melody", t("Мелодия"), "var(--color-secondary)"]
];
export const EFFECT_FIELDS = [
  ["echo", t("Эхо")],
  ["reverb", t("Реверб"), "secondary"],
  ["delay", t("Дилей")],
  ["noise_suppression", t("Шум")]
];
