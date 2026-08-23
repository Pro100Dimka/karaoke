export const FIELD_TYPES = {
  "Photon (EM)": {
    c1: "#00f2ff",
    c2: "#0051ff",
    c3: "#ffffff",
    s: 1.0,
    curl: 1.0,
    sz: 3.0,
    sc1: "#66d9ff",
    sc2: "#99eeff"
  },
  "Gluon (Strong)": {
    c1: "#ff0055",
    c2: "#7000ff",
    c3: "#ff8800",
    s: 2.5,
    curl: 2.4,
    sz: 3.4,
    sc1: "#cc66ff",
    sc2: "#ff6699"
  },
  "Higgs (Mass)": {
    c1: "#ffae00",
    c2: "#ff4800",
    c3: "#ffff00",
    s: 0.6,
    curl: 0.3,
    sz: 4.0,
    sc1: "#ffcc66",
    sc2: "#ffdd99"
  },
  Gravity: {
    c1: "#ffffff",
    c2: "#4466ff",
    c3: "#8844ff",
    s: 0.75,
    curl: 0.18,
    sz: 2.8,
    sc1: "#aabbff",
    sc2: "#ccaaff"
  },
  "Dark Energy": {
    c1: "#1a0033",
    c2: "#6600ff",
    c3: "#ff00ff",
    s: 1.9,
    curl: 1.6,
    sz: 3.1,
    sc1: "#9933ff",
    sc2: "#cc66ff"
  },
  Neutrino: {
    c1: "#00ff88",
    c2: "#00ffcc",
    c3: "#88ffff",
    s: 3.0,
    curl: 3.0,
    sz: 2.6,
    sc1: "#66ffbb",
    sc2: "#99ffdd"
  },
  "Waveform Terrain": {
    c1: "#ff3366",
    c2: "#33ff99",
    c3: "#6633ff",
    s: 0.4,
    curl: 0.15,
    sz: 2.4,
    sc1: "#ff6699",
    sc2: "#66ffcc",
    terrain: true
  }
};

export const DEFAULTS = {
  maxParticles: 250000,
  secondaryParticles: 50000,
  fieldRadius: 90,
  density: 0.043,
  sensitivity: 0.8323,
  vortexStrength: 0.73,
  pulseIntensity: 0.15,
  terrainHeight: 20,
  bloom: 0.3,
  trails: 0.66144,
  connectionThreshold: 14,
  connectionOpacity: 1
};
