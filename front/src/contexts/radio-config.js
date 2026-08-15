import { translateSaved } from "../i18n/runtime";

// Station metadata is configuration, verified as an exact contract by tests.
/* Stryker disable all */
export const RADIO_STATIONS = [
  {
    id: "poptron",
    name: "SomaFM PopTron",
    description: translateSaved("Весёлый электропоп и танцевальные хиты"),
    streams: [
      "https://ice5.somafm.com/poptron-128-mp3",
      "https://ice2.somafm.com/poptron-128-mp3"
    ]
  },
  {
    id: "indiepop",
    name: "SomaFM Indie Pop Rocks",
    description: translateSaved("Яркий инди-поп и знакомые припевы"),
    streams: [
      "https://ice5.somafm.com/indiepop-128-mp3",
      "https://ice2.somafm.com/indiepop-128-mp3"
    ]
  },
  {
    id: "beatblender",
    name: "SomaFM Beat Blender",
    description: translateSaved("Энергичная электроника и ровный бит"),
    streams: [
      "https://ice5.somafm.com/beatblender-128-mp3",
      "https://ice2.somafm.com/beatblender-128-mp3"
    ]
  },
  {
    id: "groovesalad",
    name: "SomaFM Groove Salad",
    description: translateSaved("Спокойный фон и мягкий бас"),
    streams: [
      "https://ice5.somafm.com/groovesalad-128-mp3",
      "https://ice2.somafm.com/groovesalad-128-mp3"
    ]
  }
];
/* Stryker restore all */

export const DEFAULT_RADIO_SETTINGS = Object.freeze({
  stationId: "poptron",
  volume: 0.45,
  enabled: true
});
