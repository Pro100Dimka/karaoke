import { useId } from "react";
import { RangeInput } from "../../../components/fields";
import { getSeekTime, getTimelineProgress } from "../utils/timeline";

const BAR_COUNT = 220;

export default function WaveformTimeline({ value, duration, onChange }) {
  const progress = getTimelineProgress(value, duration);
  const gradientId = `waveform-gradient-${useId().replace(/:/g, "")}`;

  const seekFromPointer = (event) => {
    if (!duration) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const seekTime = getSeekTime(
      event.clientX,
      rect.left,
      rect.width,
      duration
    );
    if (seekTime != null) onChange(seekTime);
  };

  return (
    <div
      className="waveform-timeline"
      onPointerDown={(event) => {
        event.preventDefault();
        seekFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) seekFromPointer(event);
      }}
    >
      <svg
        viewBox={`0 0 ${BAR_COUNT * 3} 44`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            id={gradientId}
            x1="0"
            y1="0"
            x2={BAR_COUNT * 3}
            y2="0"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="var(--color-primary)" />
            <stop offset="24%" stopColor="var(--color-accent)" />
            <stop offset="50%" stopColor="var(--color-success)" />
            <stop offset="74%" stopColor="var(--color-secondary)" />
            <stop offset="100%" stopColor="var(--color-primary-hover)" />
          </linearGradient>
        </defs>
        {Array.from({ length: BAR_COUNT }, (_, index) => {
          const amplitude =
            8 + Math.abs(Math.sin(index * 1.71) + Math.sin(index * 0.37)) * 11;
          const played = index / BAR_COUNT <= progress;

          return (
            <rect
              key={index}
              x={index * 3 + 0.75}
              y={22 - amplitude / 2}
              width="1.5"
              height={amplitude}
              rx=".75"
              fill={played ? `url(#${gradientId})` : "var(--waveform-future, rgba(255,255,255,.18))"}
            />
          );
        })}
        <line
          x1={progress * BAR_COUNT * 3}
          x2={progress * BAR_COUNT * 3}
          y1="0"
          y2="44"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
      <RangeInput
        aria-label="Позиция песни"
        min="0"
        max={duration || 0}
        step="0.01"
        value={Math.min(value, duration || 0)}
        onChange={onChange}
      />
    </div>
  );
}
