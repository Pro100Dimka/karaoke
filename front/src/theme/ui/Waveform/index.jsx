import { useEffect, useId, useRef, useState } from "react";
import Box from "../Box";
import RangeInput from "../RangeInput";

const COUNT = 180;
const WIDTH = COUNT * 3;
const BARS = Array.from({ length: COUNT }, (_, index) => [
  index,
  8 + Math.abs(Math.sin(index * 1.71) + Math.sin(index * 0.37)) * 11
]);

export default function Waveform({ value = 0, duration = 0, onChange, label, url }) {
  const gradient = `wave-${useId().replace(/:/g, "")}`;
  const host = useRef(null);
  const instance = useRef(null);
  const [real, setReal] = useState(false);
  const progress = duration > 0 ? Math.min(1, Math.max(0, value / duration)) : 0;
  const playhead = progress * WIDTH;

  useEffect(() => {
    if (!url || !host.current) return undefined;
    let active = true;
    import("wavesurfer.js")
      .then(({ default: WaveSurfer }) => {
        if (!active || !host.current) return;
        const styles = getComputedStyle(host.current);
        const wavesurfer = WaveSurfer.create({
          container: host.current,
          cursorColor: styles.getPropertyValue("--color-primary-hover"),
          cursorWidth: 1,
          height: "auto",
          hideScrollbar: true,
          interact: false,
          normalize: true,
          progressColor: styles.getPropertyValue("--color-highlight"),
          url,
          waveColor: styles.getPropertyValue("--color-primary")
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
  }, [url]);
  useEffect(() => {
    const wavesurfer = instance.current;
    if (wavesurfer && Math.abs(wavesurfer.getCurrentTime() - value) > 0.08)
      wavesurfer.setTime(value);
  }, [value]);
  const seek = (event) => {
    if (!duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    onChange?.(((event.clientX - rect.left) / rect.width) * duration);
  };
  return (
    <Box
      data-role="waveform"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        seek(event);
      }}
      onPointerMove={(event) =>
        (event.buttons === 1 || event.currentTarget.hasPointerCapture?.(event.pointerId)) &&
        seek(event)
      }
      sx={{ position: "relative", flex: 1, minInlineSize: 0, color: "var(--color-primary)" }}
    >
      <Box
        ref={host}
        aria-hidden="true"
        sx={{ display: url ? "block" : "none", inlineSize: "100%", blockSize: "var(--control-md)" }}
      />
      <Box
        as="svg"
        viewBox={`0 0 ${WIDTH} 44`}
        preserveAspectRatio="none"
        aria-hidden="true"
        sx={{ display: real ? "none" : "block", inlineSize: "100%", blockSize: "var(--control-md)" }}
      >
        <defs>
          <linearGradient id={gradient}>
            <stop stopColor="var(--color-primary)" />
            <stop offset=".5" stopColor="var(--color-highlight)" />
            <stop offset="1" stopColor="var(--color-secondary)" />
          </linearGradient>
          <clipPath id={`${gradient}-played`}>
            <rect width={playhead} height="44" />
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
            {BARS.map(([index, amplitude]) => (
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
        ))}
        <line x1={playhead} x2={playhead} y2="44" stroke="currentColor" />
      </Box>
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
    </Box>
  );
}
