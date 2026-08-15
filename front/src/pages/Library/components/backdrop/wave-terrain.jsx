import { useEffect, useRef } from "react";
import { useRadio } from "../../../../contexts/radio";

const ROWS = 36;
const COLUMNS = 108;
const TARGET_FRAME_TIME = 1000 / 30;
const TAU = Math.PI * 2;

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const hash = (x, y, seed = 0) => {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
};

const gaussian = (x, center, width) => {
  const distance = (x - center) / width;
  return Math.exp(-distance * distance);
};

const COLUMNS_DATA = Array.from({ length: COLUMNS }, (_, column) => {
  const x = (column / (COLUMNS - 1)) * 2 - 1;

  return {
    x,
    edge: clamp(1 - Math.abs(x) ** 4.2),
    silhouette:
      gaussian(x, -0.76, 0.13) * 0.25 +
      gaussian(x, -0.51, 0.19) * 0.5 +
      gaussian(x, -0.22, 0.2) * 0.62 +
      gaussian(x, 0.08, 0.24) * 0.54 +
      gaussian(x, 0.39, 0.19) * 0.5 +
      gaussian(x, 0.68, 0.16) * 0.39 +
      gaussian(x, 0.88, 0.09) * 0.18,
    bassShape:
      gaussian(x, -0.52, 0.23) * 0.66 +
      gaussian(x, -0.13, 0.27) * 0.88 +
      gaussian(x, 0.34, 0.23) * 0.74 +
      gaussian(x, 0.7, 0.19) * 0.5
  };
});

const PARTICLES = Array.from({ length: ROWS }, (_, row) => {
  const depth = row / (ROWS - 1);

  return Array.from({ length: COLUMNS }, (_, column) => ({
    depth,
    phase: hash(column, row, 1) * TAU,
    random: hash(column, row, 2),
    visible: hash(column, row, 3) > 0.28,
    size: 0.45 + hash(column, row, 4) * 0.65
  }));
});

const POINTS = Array.from({ length: ROWS }, () =>
  Array.from({ length: COLUMNS }, () => ({ x: 0, y: 0, terrain: 0, brightness: 0 }))
);

function getTerrainHeight(column, particle, time, energy, hit, spectrum) {
  const { x, edge, silhouette, bassShape } = COLUMNS_DATA[column];
  const { depth } = particle;
  const depthCurve = 0.48 + Math.sin(Math.PI * depth) * 0.72;

  const surface =
    Math.sin(x * 7.6 + depth * 6.2 - time * (0.78 + energy * 0.85)) * 0.05 +
    Math.sin(x * 16.4 - depth * 9.8 + time * (0.68 + energy * 0.62)) * 0.026 +
    Math.cos(x * 29 + depth * 18 + particle.phase + time * 0.46) * 0.012;

  const bassLift =
    bassShape *
    depthCurve ** 1.08 *
    (energy * 0.2 + hit * 0.38) *
    (0.86 + particle.random * 0.16);

  const bandPosition = (column / (COLUMNS - 1)) * (spectrum.length - 1);
  const bandIndex = Math.floor(bandPosition);
  const nextBand = Math.min(spectrum.length - 1, bandIndex + 1);
  const blend = bandPosition - bandIndex;
  const bandLevel =
    spectrum[bandIndex] * (1 - blend) + spectrum[nextBand] * blend;
  const bandCell = (column / (COLUMNS - 1)) * spectrum.length;
  const bandCenter = Math.abs((bandCell % 1) - 0.5) * 2;
  const bandEnvelope = 0.52 + (1 - bandCenter ** 1.7) * 0.48;
  const equalizerLift =
    bandLevel ** 1.12 *
    bandEnvelope *
    depthCurve ** 0.88 *
    (0.38 + particle.depth * 0.3) *
    (0.9 + particle.random * 0.12);

  const transientRipple =
    Math.sin(x * 22 - time * 4.2 + particle.phase) * hit * 0.052 * depthCurve;

  return (
    (silhouette * depthCurve ** 0.72 +
      surface +
      bassLift +
      equalizerLift +
      transientRipple) *
    edge
  );
}

export default function LibraryWaveTerrain() {
  const canvasRef = useRef(null);
  const { getBassLevel, getSpectrumLevels, isPlaying } = useRadio();

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true, desynchronized: true });
    if (!canvas || !context) return undefined;

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let frameId = 0;
    let lastFrame = 0;
    let energy = 0;
    let previousRawBass = 0;
    let hit = 0;
    let terrainRgb = "255,255,255";
    let terrainAccentRgb = "255,120,170";
    const spectrum = Array(18).fill(0);

    const readTerrainColor = () => {
      const value = getComputedStyle(canvas)
        .getPropertyValue("--wave-terrain-rgb")
        .trim();
      terrainRgb = /^\d+\s*,\s*\d+\s*,\s*\d+$/.test(value)
        ? value
        : "255,255,255";
      const accent = getComputedStyle(canvas)
        .getPropertyValue("--wave-terrain-accent-rgb")
        .trim();
      terrainAccentRgb = /^\d+\s*,\s*\d+\s*,\s*\d+$/.test(accent)
        ? accent
        : terrainRgb;
    };

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;

      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const updatePoints = (time) => {
      for (let row = 0; row < ROWS; row += 1) {
        for (let column = 0; column < COLUMNS; column += 1) {
          const particle = PARTICLES[row][column];
          const point = POINTS[row][column];
          const { x } = COLUMNS_DATA[column];
          const perspective = 0.44 + particle.depth * 0.9;
          const terrain = getTerrainHeight( column, particle, time, energy, hit, spectrum
          );
          const drift = Math.sin(time * 0.3 + particle.depth * 2.5) * 0.009;
          const cameraFlow =
            Math.sin(time * 0.62 + particle.depth * 8.4) *
            (0.004 + particle.depth * 0.006);

          point.x = width * 0.5 + (x + drift) * width * 0.57 * perspective;
          const horizon = 0.96 - particle.depth * 0.28 + cameraFlow * 0.55;
          const amplitude = 0.3 + particle.depth * 0.1;

          point.y = height * horizon - terrain * height * amplitude;
          point.terrain = terrain;
          point.brightness = clamp(
            0.3 +
              particle.depth * 0.52 +
              terrain * 1.12 +
              particle.random * 0.16
          );
        }
      }
    };

    const drawMesh = () => {
      context.save();
      context.globalCompositeOperation = "lighter";
      context.lineCap = "round";

      for (let row = 0; row < ROWS; row += 2) {
        context.beginPath();
        let started = false;

        for (let column = 0; column < COLUMNS; column += 1) {
          const point = POINTS[row][column];
          if (started) context.lineTo(point.x, point.y);
          else {
            context.moveTo(point.x, point.y);
            started = true;
          }
        }

        const depth = row / (ROWS - 1);
        const rowColor = row % 4 === 0 ? terrainAccentRgb : terrainRgb;
        context.strokeStyle = `rgba(${rowColor},${
          0.18 + depth * 0.34 + energy * 0.16 + hit * 0.24
        })`;
        context.lineWidth = 0.72 + depth * 0.92;
        context.stroke();
      }

      for (let column = 0; column < COLUMNS; column += 8) {
        context.beginPath();
        let started = false;

        for (let row = 0; row < ROWS; row += 1) {
          const point = POINTS[row][column];
          if (started) context.lineTo(point.x, point.y);
          else {
            context.moveTo(point.x, point.y);
            started = true;
          }
        }

        context.strokeStyle = `rgba(${terrainAccentRgb},${0.13 + energy * 0.13 + hit * 0.16})`;
        context.lineWidth = 0.48;
        context.stroke();
      }

      context.restore();
    };

    const drawParticles = () => {
      context.save();
      context.globalCompositeOperation = "lighter";

      for (let row = 0; row < ROWS; row += 1) {
        for (let column = 0; column < COLUMNS; column += 1) {
          const particle = PARTICLES[row][column];
          const point = POINTS[row][column];
          if (!particle.visible || point.terrain < -0.05) continue;

          const size =
            particle.size *
            (0.64 + particle.depth * 0.62) *
            (1 + energy * 0.42 + hit * 0.45);
          const alpha = clamp(
            point.brightness *
              (0.68 + particle.random * 0.56) *
              (1.12 + energy * 0.78 + hit * 0.94),
            0,
            1
          );

          context.fillStyle = `rgba(${column % 7 < 2 ? terrainAccentRgb : terrainRgb},${alpha})`;
          context.fillRect(point.x, point.y, size, size);
        }
      }

      context.restore();
    };

    const render = (timestamp = 0) => {
      const paused =
        reducedMotion.matches ||
        document.documentElement.dataset.performance === "reduced";

      if (!paused && timestamp - lastFrame < TARGET_FRAME_TIME) {
        frameId = requestAnimationFrame(render);
        return;
      }

      lastFrame = timestamp;
      const time = paused ? 0 : timestamp / 1000;
      const rawBass = isPlaying ? clamp(getBassLevel()) : 0;
      const rawSpectrum = isPlaying ? getSpectrumLevels() : null;
      for (let index = 0; index < spectrum.length; index += 1) {
        const target = clamp(rawSpectrum?.[index] ?? 0);
        spectrum[index] +=
          (target - spectrum[index]) * (target > spectrum[index] ? 0.62 : 0.14);
      }
      const attack = rawBass > energy ? 0.72 : 0.2;

      energy += (rawBass - energy) * attack;
      hit = Math.max(clamp((rawBass - previousRawBass) * 8.4), hit * 0.72);
      previousRawBass = rawBass;

      context.clearRect(0, 0, width, height);
      updatePoints(time);
      drawMesh();
      drawParticles();

      if (!paused) frameId = requestAnimationFrame(render);
    };

    const restart = () => {
      cancelAnimationFrame(frameId);
      lastFrame = 0;
      render();
    };

    const handleVisibility = () => {
      if (document.hidden) cancelAnimationFrame(frameId);
      else restart();
    };

    const handleResize = () => {
      resize();
      restart();
    };

    readTerrainColor();
    handleResize();
    const themeObserver = new MutationObserver(() => { readTerrainColor(); restart(); });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });

    addEventListener("resize", handleResize);
    document.addEventListener("visibilitychange", handleVisibility);
    reducedMotion.addEventListener("change", restart);

    return () => {
      cancelAnimationFrame(frameId);
      removeEventListener("resize", handleResize);
      document.removeEventListener("visibilitychange", handleVisibility);
      reducedMotion.removeEventListener("change", restart);
      themeObserver.disconnect();
    };
  }, [getBassLevel, getSpectrumLevels, isPlaying]);

  return <canvas ref={canvasRef} className="library-wave-terrain" />;
}
