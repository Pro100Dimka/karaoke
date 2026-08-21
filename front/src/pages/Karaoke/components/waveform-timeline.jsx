import { useId } from "react";
import { translateSaved } from "../../../i18n/runtime";
import { RangeInput } from "../../../theme/ui";
import { getSeekTime, getTimelineProgress } from "../utils/timeline";

const BAR_COUNT = 220;
const SVG_WIDTH = BAR_COUNT * 3;
const WAVEFORM_BARS = Array.from({ length: BAR_COUNT }, (_, index) => [
  index,
  8 + Math.abs(Math.sin(index * 1.71) + Math.sin(index * 0.37)) * 11
]);
const GRADIENT_STOPS = [
  ["0%", "var(--color-primary)"],
  ["24%", "var(--color-accent)"],
  ["50%", "var(--color-success)"],
  ["74%", "var(--color-secondary)"],
  ["100%", "var(--color-primary-hover)"]
];
export default function WaveformTimeline({ value, duration, onChange }) {
  const progress = getTimelineProgress(value, duration);
  const gradientId = `waveform-gradient-${useId().replace(/:/g, "")}`;
  const playheadX = progress * SVG_WIDTH;
  const seekFromPointer = (event) => {
    if (!duration) return;
    const { left, width } = event.currentTarget.getBoundingClientRect();
    const nextValue = getSeekTime(event.clientX, left, width, duration);
    if (nextValue != null) onChange(nextValue);
  };
  const pointerHandlers = {
    onPointerDown(event) {
      event.preventDefault();
      seekFromPointer(event);
    },
    onPointerMove(event) {
      if (event.buttons === 1) seekFromPointer(event);
    }
  };
  return (
    <div className="waveform-timeline" {...pointerHandlers}>
      <svg viewBox={`0 0 ${SVG_WIDTH} 44`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient
            id={gradientId}
            x1="0"
            y1="0"
            x2={SVG_WIDTH}
            y2="0"
            gradientUnits="userSpaceOnUse"
          >
            {GRADIENT_STOPS.map(([offset, stopColor]) => (
              <stop key={offset} offset={offset} stopColor={stopColor} />
            ))}
          </linearGradient>
          <clipPath id={`${gradientId}-played`}>
            <rect x="0" y="0" width={playheadX} height="44" />
          </clipPath>
        </defs>

        <g fill="var(--waveform-future, rgba(255,255,255,.18))">
          {WAVEFORM_BARS.map(([index, amplitude]) => (
            <rect
              key={index}
              x={index * 3 + 0.75}
              y={22 - amplitude / 2}
              width="1.5"
              height={amplitude}
              rx=".75"
            />
          ))}
        </g>
        <g fill={`url(#${gradientId})`} clipPath={`url(#${gradientId}-played)`}>
          {WAVEFORM_BARS.map(([index, amplitude]) => (
            <rect
              key={index}
              x={index * 3 + 0.75}
              y={22 - amplitude / 2}
              width="1.5"
              height={amplitude}
              rx=".75"
            />
          ))}
        </g>

        <line
          x1={playheadX}
          x2={playheadX}
          y1="0"
          y2="44"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>

      <RangeInput
        aria-label={translateSaved("Позиция песни")}
        min="0"
        max={duration || 0}
        step="0.01"
        value={Math.min(value, duration || 0)}
        onChange={onChange}
      />
    </div>
  );
}
