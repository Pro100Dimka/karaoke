import { useEffect, useId, useRef, useState } from "react";
import Box from "../Box";
import RangeInput from "../RangeInput";
import "./waveform.css";

const COUNT = 180;
const WIDTH = COUNT * 3;
const HEIGHT = 44;
const FALLBACK_SAMPLES = Array.from(
  { length: COUNT },
  (_, index) => 0.12 + Math.abs(Math.sin(index * 1.71) + Math.sin(index * 0.37)) * 0.18
);
const fallbackPath = (() => {
  const center = HEIGHT / 2;
  const points = FALLBACK_SAMPLES.map((sample, index) => ({
    x: (index / (COUNT - 1)) * WIDTH,
    halfHeight: 1 + sample * (center - 3)
  }));
  const upper = points.map(({ x, halfHeight }) => `${x.toFixed(2)} ${(center - halfHeight).toFixed(2)}`);
  const lower = points
    .map(({ x, halfHeight }) => `${x.toFixed(2)} ${(center + halfHeight).toFixed(2)}`)
    .reverse();
  return `M ${upper[0]} L ${upper.slice(1).join(" L ")} L ${lower.join(" L ")} Z`;
})();
const clampProgress = (value) => Math.min(1, Math.max(0, Number(value) || 0));

export default function Waveform({
  value = 0,
  duration = 0,
  progress: progressOverride,
  onChange,
  label,
  url,
  fetchParams,
  interactive = true,
  compact = false
}) {
  const gradient = `wave-${useId().replace(/:/g, "")}`;
  const host = useRef(null);
  const instance = useRef(null);
  const [real, setReal] = useState(false);
  const progress =
    progressOverride == null
      ? duration > 0
        ? clampProgress(value / duration)
        : 0
      : clampProgress(progressOverride);
  const playhead = progress * WIDTH;

  useEffect(() => {
    if (!url || !host.current) return undefined;
    let active = true;
    import("wavesurfer.js")
      .then(({ default: WaveSurfer }) => {
        if (!active || !host.current) return;
        const styles = getComputedStyle(host.current);
        const color = (name) => styles.getPropertyValue(name).trim();
        const wavesurfer = WaveSurfer.create({
          container: host.current,
          cursorColor: color("--color-primary-hover"),
          cursorWidth: 1,
          fetchParams,
          height: "auto",
          hideScrollbar: true,
          interact: false,
          normalize: true,
          progressColor: [color("--color-highlight"), color("--color-primary-hover")],
          url,
          waveColor: [color("--color-primary"), color("--color-secondary")]
        });
        instance.current = wavesurfer;
        wavesurfer.once("ready", () => active && setReal(true));
        wavesurfer.once("error", () => active && setReal(false));
      })
      .catch(() => {
        if (active) setReal(false);
      });
    return () => {
      active = false;
      instance.current?.destroy();
      instance.current = null;
    };
  }, [fetchParams, url]);
  useEffect(() => {
    const wavesurfer = instance.current;
    if (!wavesurfer || !real) return;
    const target =
      progressOverride == null ? value : wavesurfer.getDuration() * clampProgress(progressOverride);
    if (Math.abs(wavesurfer.getCurrentTime() - target) > 0.08) wavesurfer.setTime(target);
  }, [progressOverride, real, value]);
  const seek = (event) => {
    if (!interactive || !duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    onChange?.(((event.clientX - rect.left) / rect.width) * duration);
  };
  return (
    <Box
      className="ui-waveform"
      data-role="waveform"
      data-compact={compact ? "true" : undefined}
      data-interactive={interactive ? "true" : "false"}
      onPointerDown={(event) => {
        if (!interactive) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        seek(event);
      }}
      onPointerMove={(event) =>
        interactive &&
        (event.buttons === 1 || event.currentTarget.hasPointerCapture?.(event.pointerId)) &&
        seek(event)
      }
      sx={{ flex: "1 1 0", display: "flex", color: "var(--color-primary)" }}
    >
      <Box
        ref={host}
        className="ui-waveform__host"
        aria-hidden="true"
        sx={{ display: url ? "block" : "none" }}
      />
      <Box
        as="svg"
        className="ui-waveform__fallback"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        sx={{
          width: "stretch",
          display: real ? "none" : "block",
          position: "absolute",
          inset: 0,
        }}
      >
        <defs  >
          <linearGradient id={gradient} >
            <stop stopColor="var(--color-primary)" />
            <stop offset=".5" stopColor="var(--color-highlight)" />
            <stop offset="1" stopColor="var(--color-secondary)" />
          </linearGradient>
          <clipPath id={`${gradient}-played`}>
            <rect width={playhead} height={HEIGHT} />
          </clipPath>
        </defs>
        {["base", "played"].map((layer) => (
          <g
            key={layer}
            fill={
              layer === "played"
                ? `url(#${gradient})`
                : "color-mix(in srgb, var(--color-text) 18%, transparent)"
            }
            clipPath={layer === "played" ? `url(#${gradient}-played)` : undefined}
          >
            <path d={fallbackPath} />
          </g>
        ))}
        <line x1={playhead} x2={playhead} y2={HEIGHT} stroke="currentColor" />
      </Box>
      {interactive && (
        <RangeInput
          aria-label={label}
          min="0"
          max={duration || 0}
          step="0.01"
          value={Math.min(value, duration || 0)}
          onChange={onChange}
          style={{
            position: "absolute",
            inset: 0,
            inlineSize: "100%",
            opacity: 0,
            cursor: "pointer"
          }}
        />
      )}
    </Box>
  );
}
