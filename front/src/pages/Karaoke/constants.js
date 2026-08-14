import { translateSaved } from "../../i18n/runtime";

export const EFFECT_PRESETS = [
  {
    id: "hall",
    label: "Hall",
    symbol: "⌗",
    reverb: 0.72,
    echo: 0.22,
    delay: 0.16
  },
  {
    id: "room",
    label: "Room",
    symbol: "◇",
    reverb: 0.42,
    echo: 0.12,
    delay: 0.08
  },
  {
    id: "plate",
    label: "Plate",
    symbol: "◉",
    reverb: 0.58,
    echo: 0.08,
    delay: 0.05
  },
  {
    id: "studio",
    label: "Studio",
    symbol: "◌",
    reverb: 0.28,
    echo: 0.06,
    delay: 0.03
  },
  {
    id: "classic",
    label: translateSaved("Классика"),
    symbol: "♬",
    reverb: 0.64,
    echo: 0.18,
    delay: 0.12
  },
  {
    id: "pop",
    label: translateSaved("Поп"),
    symbol: "☆",
    reverb: 0.36,
    echo: 0.24,
    delay: 0.1
  },
  {
    id: "rock",
    label: translateSaved("Рок"),
    symbol: "ϟ",
    reverb: 0.3,
    echo: 0.12,
    delay: 0.07
  },
  {
    id: "club",
    label: translateSaved("Клуб"),
    symbol: "◎",
    reverb: 0.5,
    echo: 0.38,
    delay: 0.22
  }
];
