import { useId } from "react";
import { translateSaved as tr } from "../../../i18n/runtime";
import "./processing-signal.css";

const WIDTH = 960;
const SHAPE = Array.from({ length: 96 }, (_, index) => {
  const wave = Math.sin(index * 1.73) * 12 + Math.sin(index * 0.47) * 9;
  const noise = ((index * 37 + 19) % 23) - 11;
  return Math.max(25, Math.min(66, 45 + wave + noise));
});
const clamp = (value) => Math.min(100, Math.max(0, Number(value) || 0));

function polygon(height, compact) {
  const center = height / 2;
  const scale = compact ? 0.3 : 0.58;
  const points = SHAPE.map((value, index) => [(index * WIDTH) / (SHAPE.length - 1), value]);
  return [
    ...points.map(([x, value]) => `${x},${center - value * scale}`),
    ...points.reverse().map(([x, value]) => `${x},${center + value * scale}`)
  ].join(" ");
}

export default function ProcessingSignal({ progress = 0, compact = false }) {
  const id = useId().replaceAll(":", "");
  const value = clamp(progress);
  const rounded = Math.round(value);
  const height = compact ? 54 : 116;
  const points = polygon(height, compact);
  return (
    <figure
      className="ui-processing-signal"
      data-compact={compact || undefined}
      style={{ "--processing-progress": `${value}%` }}
      role="progressbar"
      aria-label={tr("Обработка: {0}%", { 0: rounded })}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={rounded}
    >
      <svg viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-progress`} x1="0" x2="1">
            <stop offset="0" stopColor="var(--color-highlight)" />
            <stop offset="0.58" stopColor="var(--color-primary-hover)" />
            <stop offset="1" stopColor="var(--color-primary)" />
          </linearGradient>
        </defs>
        <polygon className="ui-processing-signal__muted" points={points} />
        <polygon
          className="ui-processing-signal__active"
          points={points}
          fill={`url(#${id}-progress)`}
        />
      </svg>
      <span className="ui-processing-signal__cursor" aria-hidden="true" />
      <strong>{rounded}%</strong>
    </figure>
  );
}
