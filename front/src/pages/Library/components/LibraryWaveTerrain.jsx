import { useEffect, useRef } from "react";

const ROWS = 26;
const COLUMNS = 56;

export default function LibraryWaveTerrain() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const context = canvas.getContext("2d");
    if (!context) return undefined;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let animationFrame = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const project = (row, column, time) => {
      const depth = row / ROWS;
      const scale = depth * depth;
      const horizontal = column / COLUMNS - 0.5;
      const spread = 0.24 + scale * 1.2;
      const x = width / 2 + horizontal * width * spread;
      const horizon = height * 0.06;
      const baseY = horizon + scale * (height - horizon);
      const amplitude = 3 + scale * 32;
      const wave =
        Math.sin(horizontal * 6 + row * 0.35 + time * 1.05) *
          amplitude *
          0.6 +
        Math.sin(horizontal * 2.2 - row * 0.22 + time * 0.68) *
          amplitude *
          0.7 +
        Math.cos(row * 0.5 + time * 1.5) * amplitude * 0.3;

      return {
        x,
        y: baseY - wave * (0.3 + scale * 0.9),
        scale
      };
    };

    const draw = (timestamp = 0) => {
      context.clearRect(0, 0, width, height);
      const time = reducedMotion.matches ? 0 : timestamp * 0.001;
      const points = [];

      for (let row = 0; row <= ROWS; row += 1) {
        const rowPoints = [];
        for (let column = 0; column <= COLUMNS; column += 1) {
          rowPoints.push(project(row, column, time));
        }
        points.push(rowPoints);
      }

      const isLight = document.documentElement.dataset.theme === "light";

      for (let row = 0; row <= ROWS; row += 1) {
        const rowPoints = points[row];
        const scale = rowPoints[Math.floor(rowPoints.length / 2)].scale;
        const alpha = (isLight ? 0.08 : 0.08) + scale * (isLight ? 0.42 : 0.62);
        const hue = (isLight ? 344 : 352) + scale * (isLight ? 10 : 16);
        const saturation = isLight ? 86 : 100;
        const lightness = (isLight ? 58 : 48) + scale * (isLight ? 16 : 24);

        context.strokeStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
        context.lineWidth = 0.55 + scale * 1.65;
        context.shadowColor = `hsla(${hue}, ${saturation}%, ${isLight ? 66 : 58}%, ${
          (isLight ? 0.34 : 0.48) * scale
        })`;
        context.shadowBlur = 2 + scale * 10;
        context.beginPath();
        context.moveTo(rowPoints[0].x, rowPoints[0].y);

        for (let column = 1; column < rowPoints.length; column += 1) {
          context.lineTo(rowPoints[column].x, rowPoints[column].y);
        }
        context.stroke();
      }

      context.shadowBlur = 0;
      for (let column = 0; column <= COLUMNS; column += 2) {
        context.beginPath();
        points.forEach((rowPoints, row) => {
          const point = rowPoints[column];
          if (row === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        });
        context.strokeStyle = isLight
          ? "rgba(196, 46, 83, 0.24)"
          : "rgba(255, 72, 92, 0.24)";
        context.lineWidth = 0.55;
        context.stroke();
      }

      if (!reducedMotion.matches) {
        animationFrame = window.requestAnimationFrame(draw);
      }
    };

    const restart = () => {
      window.cancelAnimationFrame(animationFrame);
      draw(0);
    };

    const themeObserver = new MutationObserver(restart);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });

    resize();
    draw(0);
    window.addEventListener("resize", resize);
    reducedMotion.addEventListener("change", restart);

    return () => {
      themeObserver.disconnect();
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      reducedMotion.removeEventListener("change", restart);
    };
  }, []);

  return <canvas ref={canvasRef} className="library-wave-terrain" />;
}
