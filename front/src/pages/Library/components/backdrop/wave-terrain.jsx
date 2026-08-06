import { useEffect, useRef } from "react";
import { useRadio } from "../../../../contexts/radio";

const ROWS = 46;
const COLUMNS = 104;
const TAU = Math.PI * 2;

const clamp = (value, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

const hash = (x, y, seed = 0) => {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
};

const gaussian = (x, center, width) => {
  const distance = (x - center) / width;
  return Math.exp(-distance * distance);
};

function createParticles() {
  return Array.from({ length: ROWS }, (_, row) => {
    const depth = row / (ROWS - 1);

    return Array.from({ length: COLUMNS }, (_, column) => {
      const x = column / (COLUMNS - 1) * 2 - 1;
      const random = hash(column, row, 1);
      const random2 = hash(column, row, 2);

      return {
        x,
        depth,
        random,
        random2,
        phase: hash(column, row, 3) * TAU,
        size: 0.35 + random * 1.05,
        visible: random2 > 0.08
      };
    });
  });
}

const PARTICLES = createParticles();

function getMountainHeight(x, depth, time, bass, particle) {
  const centerShift = Math.sin(time * 0.11) * 0.045;
  const mainPeak = gaussian(x, centerShift - 0.06, 0.24) * 1.12;
  const leftPeak = gaussian(x, -0.53, 0.17) * 0.62;
  const rightPeak = gaussian(x, 0.48, 0.21) * 0.72;
  const farLeft = gaussian(x, -0.82, 0.11) * 0.28;
  const farRight = gaussian(x, 0.83, 0.13) * 0.34;

  const silhouette = mainPeak + leftPeak + rightPeak + farLeft + farRight;
  const depthEnvelope = Math.sin(Math.PI * depth) ** 0.72;
  const edgeEnvelope = clamp(1 - Math.abs(x) ** 3.2);

  const broadWave =
    Math.sin(x * 6.2 + depth * 5.4 - time * 0.42) * 0.07 +
    Math.sin(x * 13.5 - depth * 8.2 + time * 0.31) * 0.045;

  const detail =
    Math.sin(x * 31 + depth * 19 + particle.phase + time * 0.26) * 0.025 +
    Math.cos(x * 52 - depth * 27 + particle.phase * 0.7) * 0.015;

  const bassPulse = Math.pow(clamp(bass), 1.25);
  const bassShape =
    gaussian(x, -0.08, 0.38) *
    Math.sin(depth * Math.PI) ** 1.4 *
    (0.24 + particle.random * 0.12) *
    bassPulse;

  return (
    (silhouette * depthEnvelope + broadWave + detail + bassShape) *
    edgeEnvelope
  );
}

export default function LibraryWaveTerrain() {
  const canvasRef = useRef(null);
  const { getBassLevel, isPlaying } = useRadio();

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !context) return undefined;

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let frameId = 0;
    let smoothBass = 0;

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const project = (particle, time, bass) => {
      const perspective = 0.46 + particle.depth * 0.82;
      const mountain = getMountainHeight(
        particle.x,
        particle.depth,
        time,
        bass,
        particle
      );

      const drift = Math.sin(time * 0.18 + particle.depth * 2.3) * 0.018;
      const x =
        width * 0.5 +
        (particle.x + drift) * width * 0.57 * perspective;

      const baseY = height * (0.76 - particle.depth * 0.24);
      const y = baseY - mountain * height * (0.48 + particle.depth * 0.12);

      return {
        x,
        y,
        depth: particle.depth,
        mountain,
        brightness: clamp(
          0.14 +
            particle.depth * 0.52 +
            mountain * 0.58 +
            particle.random * 0.22
        )
      };
    };

    const drawConnections = (projected, bass) => {
      context.save();
      context.globalCompositeOperation = "lighter";
      context.lineCap = "round";

      for (let row = 0; row < ROWS; row += 2) {
        const rowPoints = projected[row];
        context.beginPath();
        let started = false;

        for (let column = 0; column < COLUMNS; column += 1) {
          const point = rowPoints[column];
          if (!point || point.mountain < 0.025) {
            started = false;
            continue;
          }

          if (!started) {
            context.moveTo(point.x, point.y);
            started = true;
          } else {
            context.lineTo(point.x, point.y);
          }
        }

        const rowDepth = row / (ROWS - 1);
        context.strokeStyle = `rgba(255,255,255,${0.025 + rowDepth * 0.085 + bass * 0.035})`;
        context.lineWidth = 0.35 + rowDepth * 0.45;
        context.stroke();
      }

      for (let column = 0; column < COLUMNS; column += 4) {
        context.beginPath();
        let started = false;

        for (let row = 0; row < ROWS; row += 1) {
          const point = projected[row][column];
          if (!point || point.mountain < 0.035) {
            started = false;
            continue;
          }

          if (!started) {
            context.moveTo(point.x, point.y);
            started = true;
          } else {
            context.lineTo(point.x, point.y);
          }
        }

        context.strokeStyle = `rgba(255,255,255,${0.018 + bass * 0.025})`;
        context.lineWidth = 0.35;
        context.stroke();
      }

      context.restore();
    };

    const drawParticles = (projected, bass) => {
      context.save();
      context.globalCompositeOperation = "lighter";

      for (let row = 0; row < ROWS; row += 1) {
        for (let column = 0; column < COLUMNS; column += 1) {
          const particle = PARTICLES[row][column];
          const point = projected[row][column];
          if (!particle.visible || point.mountain < 0.018) continue;

          const ridge = clamp(point.mountain * 1.3);
          const pulse = 1 + bass * (0.7 + ridge * 1.5);
          const radius = particle.size * (0.42 + point.depth * 0.65) * pulse;
          const alpha = clamp(
            point.brightness *
              (0.22 + particle.random * 0.58) *
              (0.68 + bass * 0.52),
            0,
            0.96
          );

          context.fillStyle = `rgba(255,255,255,${alpha})`;
          context.beginPath();
          context.arc(point.x, point.y, radius, 0, TAU);
          context.fill();

          if (ridge > 0.52 && particle.random > 0.78) {
            context.fillStyle = `rgba(255,255,255,${alpha * 0.16})`;
            context.beginPath();
            context.arc(point.x, point.y, radius * (2.6 + bass * 2.4), 0, TAU);
            context.fill();
          }
        }
      }

      context.restore();
    };

    const drawMist = (bass) => {
      const gradient = context.createRadialGradient(
        width * 0.5,
        height * 0.54,
        0,
        width * 0.5,
        height * 0.54,
        width * 0.52
      );
      gradient.addColorStop(0, `rgba(255,255,255,${0.025 + bass * 0.035})`);
      gradient.addColorStop(0.42, `rgba(255,255,255,${0.012 + bass * 0.018})`);
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
    };

    const draw = (timestamp = 0) => {
      const paused = reducedMotion.matches;
      const time = paused ? 0 : timestamp / 1000;
      const targetBass = isPlaying ? getBassLevel() : 0;
      smoothBass += (targetBass - smoothBass) * (targetBass > smoothBass ? 0.34 : 0.08);

      context.clearRect(0, 0, width, height);
      drawMist(smoothBass);

      const projected = PARTICLES.map((row) =>
        row.map((particle) => project(particle, time, smoothBass))
      );

      drawConnections(projected, smoothBass);
      drawParticles(projected, smoothBass);

      if (!paused) frameId = requestAnimationFrame(draw);
    };

    const restart = () => {
      cancelAnimationFrame(frameId);
      draw();
    };

    const handleResize = () => {
      resize();
      restart();
    };

    handleResize();
    addEventListener("resize", handleResize);
    reducedMotion.addEventListener("change", restart);

    return () => {
      cancelAnimationFrame(frameId);
      removeEventListener("resize", handleResize);
      reducedMotion.removeEventListener("change", restart);
    };
  }, [getBassLevel, isPlaying]);

  return <canvas ref={canvasRef} className="library-wave-terrain" />;
}
