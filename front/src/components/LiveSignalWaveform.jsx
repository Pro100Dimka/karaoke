import { useEffect, useId, useRef } from "react";
import { translateSaved as tr } from "../i18n/runtime";
import { Box } from "../theme/ui";

import "./live-signal-waveform.css";

const SAMPLE_COUNT = 64;
const WIDTH = 256;
const HEIGHT = 48;
const MIDLINE = HEIGHT / 2;
const EMPTY_SIGNAL = Object.freeze(Array.from({ length: SAMPLE_COUNT }, () => 0));

const clampLevel = (value, max) =>
  Math.max(0, Math.min(1, Number(value || 0) / Math.max(Number(max) || 1, 0.001)));

const point = (index, amplitude, direction) => {
  const x = (index / (SAMPLE_COUNT - 1)) * WIDTH;
  const halfHeight = 1 + amplitude ** 0.68 * (MIDLINE - 3);
  return `${x.toFixed(2)} ${(MIDLINE + direction * halfHeight).toFixed(2)}`;
};

const waveformPath = (samples, active) => {
  const values = active ? samples : EMPTY_SIGNAL;
  const upper = values.map((sample, index) => point(index, sample, -1));
  const lower = values.map((sample, index) => point(index, sample, 1)).reverse();
  return `M ${upper[0]} L ${upper.slice(1).join(" L ")} L ${lower.join(" L ")} Z`;
};

export default function LiveSignalWaveform({
  active,
  level,
  max = 100,
  compact = false,
  ariaLabel = tr("settings.audio.microphoneLevel"),
  title
}) {
  const gradientId = `live-wave-${useId().replace(/:/g, "")}`;
  const pathRef = useRef(null);
  const targetRef = useRef(0);

  useEffect(() => {
    targetRef.current = active ? clampLevel(level, max) : 0;
  }, [active, level, max]);

  useEffect(() => {
    const path = pathRef.current;
    if (!path || !active) {
      path?.setAttribute("d", waveformPath(EMPTY_SIGNAL, false));
      return undefined;
    }

    const samples = [...EMPTY_SIGNAL];
    let envelope = 0;
    const draw = () => {
      const target = targetRef.current;
      const smoothing = target > envelope ? 0.3 : 0.11;
      envelope += (target - envelope) * smoothing;
      if (envelope < 0.001) envelope = 0;
      samples.shift();
      samples.push(envelope);
      path.setAttribute("d", waveformPath(samples, true));
    };
    draw();
    // A sample used to cross the compact meter in about one second, which
    // looked like a racing scan line. About 1.8 seconds keeps it responsive
    // to speech while making the movement calmer and easier to read.
    const interval = globalThis.setInterval(draw, 28);
    return () => globalThis.clearInterval(interval);
  }, [active]);

  const normalizedLevel = active ? clampLevel(level, max) : 0;

  return (
    <Box
      className="live-signal-wave"
      data-active={active ? "true" : "false"}
      data-compact={compact ? "true" : undefined}
      role="meter"
      aria-label={ariaLabel}
      aria-valuemin="0"
      aria-valuemax="100"
      sx={{ flex: 1 }}
      aria-valuenow={Math.round(normalizedLevel * 100)}
      title={title}
    >
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId}>
            <stop stopColor="var(--color-secondary)" />
            <stop offset=".52" stopColor="var(--color-primary)" />
            <stop offset="1" stopColor="var(--color-highlight)" />
          </linearGradient>
        </defs>
        <line className="live-signal-wave__axis" x2={WIDTH} y1={MIDLINE} y2={MIDLINE} />
        <path
          ref={pathRef}
          className="live-signal-wave__shape"
          d={waveformPath(EMPTY_SIGNAL, false)}
          fill={`url(#${gradientId})`}
        />
      </svg>
    </Box>
  );
}
