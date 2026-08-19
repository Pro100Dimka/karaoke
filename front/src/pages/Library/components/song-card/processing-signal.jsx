import { useId } from "react";
import { translateSaved } from "../../../../i18n/runtime";
import { clamp as clampRange } from "../../../../utils/math";

const WAVE_CONFIG = {
  length: 96,
  start: 65,
  min: 36,
  max: 70,
  variation: 30 // насколько сильно может прыгать соседняя точка
};
const POINTS = (() => {
  const { length, start, min, max, variation } = WAVE_CONFIG;
  let value = start;
  return Array.from({ length }, () => {
    value += Math.floor(Math.random() * (variation * 2 + 1)) - variation;
    value = Math.max(min, Math.min(max, value));
    return value;
  });
})();
const WIDTH = 960;
const clamp = (value) => clampRange(Number(value) || 0, 0, 100);
function createPolygon(height, compact) {
  const center = height / 2;
  const step = WIDTH / (POINTS.length - 1);
  const scale = compact ? 0.28 : 0.55;
  const line = (points, direction) =>
    points
      .map((value, index) => {
        const sourceIndex = direction < 0 ? index : POINTS.length - 1 - index;
        return `${sourceIndex * step},${center + direction * value * scale}`;
      })
      .join(" ");
  return `${line(POINTS, -1)} ${line([...POINTS].reverse(), 1)}`;
}
export default function ProcessingSignal({ progress = 0, compact = false }) {
  const id = useId().replaceAll(":", "");
  const normalized = clamp(progress);
  const rounded = Math.round(normalized);
  const height = compact ? 54 : 116;
  const center = height / 2;
  const polygon = createPolygon(height, compact);
  const gradientId = `${id}-gradient`;
  const clipId = `${id}-clip`;
  return (
    <div
      className={`processing-signal${compact ? " processing-signal--compact" : ""}`}
      style={{
        width: "100%",
        "--processing-progress": `${normalized}%`
      }}
      aria-label={translateSaved("Обработка: {0}%", { 0: rounded })}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={rounded}
    >
      <svg
        className="processing-signal__wave"
        viewBox={`0 0 ${WIDTH} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="1">
            <stop offset="0" stopColor="var(--color-highlight)" />
            <stop offset="0.55" stopColor="var(--color-primary)" />
            <stop offset="1" stopColor="var(--color-accent)" />
          </linearGradient>
          <clipPath id={clipId}>
            <rect width={(WIDTH * normalized) / 100} height={height} />
          </clipPath>
        </defs>
        <line className="processing-signal__baseline" x1={0} y1={center} x2={WIDTH} y2={center} />
        <polygon className="processing-signal__wave-muted" points={polygon} />
        <polygon
          className="processing-signal__wave-active"
          points={polygon}
          fill={`url(#${gradientId})`}
          clipPath={`url(#${clipId})`}
        />
      </svg>
      <span className="processing-signal__cursor" aria-hidden="true" />
      <span className="processing-signal__value">{rounded}%</span>
    </div>
  );
}
