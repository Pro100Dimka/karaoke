import { translateSaved as t } from "../../i18n/runtime";

export const EFFECT_PRESETS = [
  { id: "classic", label: t("karaoke.classic"), symbol: "♬", echo: 0.18, reverb: 0.64, delay: 0.12 },
  { id: "hall", label: t("karaoke.hall"), symbol: "⌗", echo: 0.22, reverb: 0.72, delay: 0.16 },
  { id: "room", label: t("karaoke.room"), symbol: "◇", echo: 0.12, reverb: 0.42, delay: 0.08 },
  { id: "plate", label: t("karaoke.plate"), symbol: "◉", echo: 0.08, reverb: 0.58, delay: 0.05 },
  { id: "studio", label: t("karaoke.studio"), symbol: "◌", echo: 0.06, reverb: 0.28, delay: 0.03 },
  { id: "pop", label: t("karaoke.pop"), symbol: "☆", echo: 0.24, reverb: 0.36, delay: 0.1 },
  { id: "rock", label: t("karaoke.rock"), symbol: "ϟ", echo: 0.12, reverb: 0.3, delay: 0.07 },
  { id: "club", label: t("karaoke.club"), symbol: "◎", echo: 0.38, reverb: 0.5, delay: 0.22 }
];
