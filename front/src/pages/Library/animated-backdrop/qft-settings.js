export const QFT_DEFAULT_SETTINGS = Object.freeze({
  // =========================================================
  // MAIN
  // =========================================================

  fieldType: "Neutrino",

  // 0 = нет реакции
  // 0.5 = слабая
  // 1 = обычная
  // 1.5 = сильная
  // 2+ = очень сильная
  sensitivity: 1.1,

  // 0.005 = очень мало частиц
  // 0.01 = мало
  // 0.017 = средне
  // 0.032 = плотное поле
  // 0.05+ = очень много
  density: 0.032,

  // 0 = остановлено
  // 0.5 = медленно
  // 1 = нормально
  // 2 = быстро
  timeFlow: 1,

  // =========================================================
  // ENVIRONMENT
  // =========================================================

  // QFT-туманность выключена, чтобы не перекрывать твой фон
  spaceNebula: false,

  nebulaIntensity: 0,

  // Сеть между частицами
  forceNetwork: true,

  // Меньше = компактнее сеть
  // Больше = длинные линии через экран
  networkRange: 11,

  // Яркость линий
  networkOpacity: 0.28,

  networkCrawlers: true,

  particleTrails: true,

  // Шлейфы частиц
  trailOpacity: 0.65,

  // =========================================================
  // CAMERA & LENS
  // =========================================================

  lensFlare: false,

  flareIntensity: 0,

  depthOfField: false,

  focusRing: 0.02111,

  focusFalloff: 0.4,

  blurAmount: 0.36,

  // Лёгкая реакция камеры
  cameraShake: 0.08,

  // =========================================================
  // POST PROCESSING
  // =========================================================

  // Свечение
  bloom: 0.55,

  // Шлейф движения
  motionBlur: 0.72,

  // RGB-разделение
  chromaticAberration: 0.0015,

  // Горизонтальное растягивание свечения
  anamorphicStretch: 0.08,

  godRays: false,

  godRaysIntensity: 0,

  // Без лишнего шума
  filmGrain: 0,

  // =========================================================
  // PHYSICS
  // =========================================================

  // Закручивание
  vortex: 0.85,

  // Пульсация
  pulseIntensity: 0.32,

  // =========================================================
  // AUDIO GATE
  // =========================================================

  bassGateEnabled: false,

  bassGateThreshold: 0.08,

  bassGateAttack: 0.22,

  bassGateRelease: 0.12,

  bassGateRatio: 2.3,

  // =========================================================
  // ENHANCEMENT
  // =========================================================

  onsetSensitivity: 1.25,

  onsetPunch: true,

  audioCamera: true,

  audioCameraIntensity: 0.12,

  terrainHeight: 20,

  // =========================================================
  // FIELD / PLACEMENT
  // =========================================================

  maxParticles: 250000,

  secondaryParticles: 50000,

  // Сильно компактнее, чем 90
  fieldRadius: 58,

  // Не растягиваем сцену по экрану
  scale: [1, 1, 1],

  // По центру
  position: [0, 0, 0],

  // =========================================================
  // ZOOM / CAMERA
  // =========================================================

  // [X, Y, Z]
  //
  // меньше Z = ближе
  // больше Z = дальше
  //
  // 80  = близко
  // 100 = немного ближе
  // 115 = хороший баланс
  // 140 = дальше
  camera: [0, 2, 115],

  secondaryParticlesEnabled: true,

  // Спокойное вращение
  idleRotationSpeed: 0.035,

  // Баланс качества и производительности
  pixelRatioMax: 1.5,

  // Яркость точек, в том числе когда музыка не играет
  exposure: 2.15,

  // =========================================================
  // BACKGROUND
  // =========================================================

  // Твой основной background не трогаем
  backgroundDim: 0,

  backgroundBrightness: 1,

  backgroundSaturation: 1,

  // =========================================================
  // QUALITY
  // =========================================================

  // Off by default meant this safety net never actually ran for anyone --
  // there is no settings UI that exposes it, so a weak machine just sat at
  // a fixed pixel ratio and stayed janky forever instead of ever stepping
  // down. It only ever adjusts pixelRatio when measured FPS drifts outside
  // targetFPS +-6..8, so a machine already holding 60fps never notices it.
  adaptiveQuality: true,

  targetFPS: 60
});

// Steps the render pixel ratio down when measured FPS falls behind target
// (giving up some sharpness for headroom on weak hardware) and back up once
// FPS comfortably clears it again, capped to [minPixelRatio, pixelRatioMax].
// A dead zone around targetFPS (-8 to +6) avoids oscillating the pixel ratio
// back and forth on machines hovering right at the edge.
export function nextAdaptivePixelRatio(
  currentPixelRatio,
  fps,
  { targetFPS, pixelRatioMax, minPixelRatio = 0.75 }
) {
  if (fps < targetFPS - 8) return Math.max(minPixelRatio, currentPixelRatio - 0.1);
  if (fps > targetFPS + 6) return Math.min(pixelRatioMax, currentPixelRatio + 0.05);
  return currentPixelRatio;
}

const readThemeColor = (name) => {
  if (typeof document === "undefined") {
    return "#ffffff";
  }

  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#ffffff";
};

export const getQftThemeName = () => {
  if (typeof document === "undefined") {
    return "dark";
  }

  return document.documentElement.dataset.theme || "dark";
};

export const getQftThemeStyle = () => ({
  particle1: readThemeColor("--color-primary"),

  particle2: readThemeColor("--color-accent"),

  particle3: readThemeColor("--color-highlight"),

  secondary1: readThemeColor("--color-primary-hover"),

  secondary2: readThemeColor("--color-rose"),

  network1: readThemeColor("--color-primary"),

  network2: readThemeColor("--color-peach"),

  trail: readThemeColor("--color-danger"),

  fog: readThemeColor("--color-bg-deep"),

  nebula1: readThemeColor("--color-primary-strong"),

  nebula2: readThemeColor("--color-primary"),

  flare: readThemeColor("--color-highlight")
});

export const QFT_THEME_STYLES = Object.freeze({
  get dark() {
    return getQftThemeStyle();
  },

  get light() {
    return getQftThemeStyle();
  },

  get green() {
    return getQftThemeStyle();
  },

  get violet() {
    return getQftThemeStyle();
  }
});
