import { useEffect, useRef } from "react";

const ROWS = 24;
const COLUMNS = 72;
const BANDS = 18;
const FRAME_MS = 1000 / 30;
const NOTES = Array.from({ length: 15 }, (_, index) => ({
  x: ((index * 37 + 11) % 96) / 100,
  y: ((index * 23 + 7) % 68) / 100,
  speed: 0.07 + (index % 5) * 0.012,
  phase: index * 1.71,
  glyph: index % 3 ? "♪" : "♫"
}));

const cssNumber = (styles, name) => Number.parseFloat(styles.getPropertyValue(name)) || 0;

function drawTerrain(context, width, height, time, bass, bands, pointer, color) {
  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  for (let row = 0; row < ROWS; row += 1) {
    const depth = row / (ROWS - 1);
    const perspective = 0.45 + depth * 0.78;
    context.beginPath();
    for (let column = 0; column < COLUMNS; column += 1) {
      const x = column / (COLUMNS - 1);
      const centered = x * 2 - 1;
      const band = bands[Math.min(BANDS - 1, Math.floor(x * BANDS))];
      const ridge =
        Math.sin(centered * 8 + depth * 6 - time * (0.7 + bass)) * 0.035 +
        Math.cos(centered * 17 - depth * 9 + time * 0.45) * 0.018 +
        Math.exp(-centered * centered * 1.8) * (0.16 + band * 0.2 + bass * 0.12);
      const px = width * (0.5 + centered * 0.58 * perspective) - pointer.x * depth * 10;
      const py = height * (1.09 - depth * 0.29 - ridge * (0.75 + depth)) - pointer.y * depth * 6;
      if (column) context.lineTo(px, py);
      else context.moveTo(px, py);
      if ((row + column) % 9 === 0) context.fillRect(px, py, 0.7 + depth, 0.7 + depth);
    }
    context.strokeStyle = `${color}, ${0.12 + depth * 0.35 + bass * 0.12})`;
    context.fillStyle = `${color}, ${0.26 + depth * 0.34})`;
    context.lineWidth = 0.55 + depth;
    context.stroke();
  }
  context.restore();
}

function drawNotes(context, width, height, time, bass, pointer, color) {
  context.save();
  context.fillStyle = `${color}, ${0.1 + bass * 0.12})`;
  context.textAlign = "center";
  NOTES.forEach(({ x, y, speed, phase, glyph }, index) => {
    const wave = Math.sin(time * 0.65 + phase);
    context.font = `${18 + (index % 4) * 5}px sans-serif`;
    context.fillText(
      glyph,
      x * width + wave * 13 - pointer.x * 7,
      ((y - time * speed + 2) % 1) * height * 0.72 + wave * 7 - pointer.y * 4
    );
  });
  context.restore();
}

export default function AnimatedLibraryBackdrop() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (typeof CanvasRenderingContext2D === "undefined") return undefined;
    const context = canvas?.getContext("2d", { alpha: true, desynchronized: true });
    if (!canvas || !context) return undefined;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = { x: 0, y: 0 };
    let frame = 0;
    let previous = 0;
    let width = 0;
    let height = 0;
    let color = "rgba(255, 70, 120";

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      const ratio = Math.min(devicePixelRatio || 1, 1.25);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const computed = getComputedStyle(canvas);
      const rgb = computed.color
        .match(/[\d.]+/g)
        ?.slice(0, 3)
        .join(", ");
      color = `rgba(${rgb || "255, 70, 120"}`;
    };
    const render = (timestamp = 0) => {
      const reduced =
        reducedMotion.matches || document.documentElement.dataset.performance === "reduced";
      if (!reduced && timestamp - previous < FRAME_MS) {
        frame = requestAnimationFrame(render);
        return;
      }
      previous = timestamp;
      const styles = getComputedStyle(document.documentElement);
      const bass = cssNumber(styles, "--radio-bass");
      const bands = Array.from({ length: BANDS }, (_, index) =>
        cssNumber(styles, `--radio-band-${index}`)
      );
      context.clearRect(0, 0, width, height);
      drawNotes(context, width, height, reduced ? 0 : timestamp / 1000, bass, pointer, color);
      drawTerrain(
        context,
        width,
        height,
        reduced ? 0 : timestamp / 1000,
        bass,
        bands,
        pointer,
        color
      );
      if (!reduced) frame = requestAnimationFrame(render);
    };
    const move = ({ clientX, clientY }) => {
      pointer.x = clientX / Math.max(1, innerWidth) - 0.5;
      pointer.y = clientY / Math.max(1, innerHeight) - 0.5;
    };
    const restart = () => {
      cancelAnimationFrame(frame);
      resize();
      render();
    };
    restart();
    addEventListener("resize", restart);
    addEventListener("pointermove", move, { passive: true });
    reducedMotion.addEventListener("change", restart);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("resize", restart);
      removeEventListener("pointermove", move);
      reducedMotion.removeEventListener("change", restart);
    };
  }, []);
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        color: "var(--ui-primary)"
      }}
    />
  );
}
