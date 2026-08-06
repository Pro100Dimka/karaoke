import { useEffect, useRef } from "react";
import { useRadio } from "../../../../contexts/radio";

const ROWS = 26;
const COLUMNS = 56;
const THEMES = {
  light: [344, 10, 86, 58, 16, 66, 0.34, 0.42, "196, 46, 83"],
  dark: [352, 16, 100, 48, 24, 58, 0.48, 0.62, "255, 72, 92"]
};

export default function LibraryWaveTerrain() {
  const canvasRef = useRef(null);
  const { getBassLevel, isPlaying } = useRadio();
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return undefined;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let frameId = 0;
    const resize = () => {
      ({ clientWidth: width, clientHeight: height } = canvas);
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const project = (row, column, time) => {
      const scale = (row / ROWS) ** 2;
      const horizontal = column / COLUMNS - 0.5;
      const bass = isPlaying ? getBassLevel() : 0;
      const bassCurve = Math.pow(Math.max(0, bass), 1.35);
      const amplitude = 3 + scale * (32 + bassCurve * 82);
      const horizon = height * 0.06;
      const wave =
        amplitude *
        (Math.sin(horizontal * 6 + row * 0.35 + time * 1.05) * 0.6 +
          Math.sin(horizontal * 2.2 - row * 0.22 + time * 0.68) * 0.7 +
          Math.cos(row * 0.5 + time * 1.5) * 0.3 +
          Math.sin(horizontal * 11 - time * 2.8) * bassCurve * (0.7 + scale * 1.4));
      return {
        x: width / 2 + horizontal * width * (0.24 + scale * 1.2),
        y: horizon + scale * (height - horizon) - wave * (0.3 + scale * 0.9),
        scale
      };
    };

    const trace = (points) => {
      context.beginPath();
      points.forEach(({ x, y }, index) =>
        index ? context.lineTo(x, y) : context.moveTo(x, y)
      );
      context.stroke();
    };

    const draw = (timestamp = 0) => {
      const paused = reducedMotion.matches;
      const time = paused ? 0 : timestamp / 1000;
      const points = Array.from({ length: ROWS + 1 }, (_, row) =>
        Array.from({ length: COLUMNS + 1 }, (_, column) =>
          project(row, column, time)
        )
      );
      const theme =
        THEMES[document.documentElement.dataset.theme] ?? THEMES.dark;
      const [
        baseHue,
        hueShift,
        saturation,
        baseLightness,
        lightnessShift,
        shadowLightness,
        shadowAlpha,
        alphaShift,
        columnColor
      ] = theme;
      context.clearRect(0, 0, width, height);
      points.forEach((rowPoints) => {
        const { scale } = rowPoints[Math.floor(rowPoints.length / 2)];
        const hue = baseHue + scale * hueShift;
        context.strokeStyle = `hsla(${hue}, ${saturation}%, ${
          baseLightness + scale * lightnessShift
        }%, ${0.08 + scale * alphaShift})`;
        context.lineWidth = 0.55 + scale * 1.65;
        context.shadowColor = `hsla(${hue}, ${saturation}%, ${shadowLightness}%, ${
          shadowAlpha * scale
        })`;
        context.shadowBlur = 2 + scale * 10;
        trace(rowPoints);
      });
      context.shadowBlur = 0;
      context.strokeStyle = `rgba(${columnColor}, 0.24)`;
      context.lineWidth = 0.55;
      for (let column = 0; column <= COLUMNS; column += 2) {
        trace(points.map((row) => row[column]));
      }
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
    const observer = new MutationObserver(restart);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });
    handleResize();
    addEventListener("resize", handleResize);
    reducedMotion.addEventListener("change", restart);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frameId);
      removeEventListener("resize", handleResize);
      reducedMotion.removeEventListener("change", restart);
    };
  }, [getBassLevel, isPlaying]);

  return <canvas ref={canvasRef} className="library-wave-terrain" />;
}
