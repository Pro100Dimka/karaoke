import { Mic } from "lucide-react";

import { Stack } from "../../../../theme/ui";

import { EFFECT_FIELDS, MIXER_FIELDS } from "./config";

import EffectDial from "./effect-dial";
import { clamp } from "./utils";

const MIXER_COLORS = {
  microphone: "#ff1744",
  music: "#38e6b0",
  vocal: "#ff7043",
  melody: "#c2183a"
};

function VerticalSlider({ label, value, color, onChange, onCommit }) {
  const percent = Math.round((value ?? 0) * 100);

  return (
    <Stack
      align="center"
      gap={1}
      sx={{
        minWidth: 72,
        userSelect: "none"
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color
        }}
      >
        {label}
      </span>

      <div
        style={{
          position: "relative",

          width: 28,
          height: 120,

          display: "grid",
          placeItems: "center"
        }}
      >
        <div
          style={{
            position: "absolute",

            width: 8,
            height: "100%",

            borderRadius: 999,

            background:
              "color-mix(in srgb, var(--color-surface-strong) 84%, transparent)",

            border:
              "1px solid color-mix(in srgb, var(--color-border-strong) 72%, transparent)",

            boxShadow:
              "inset 0 0 0.45rem color-mix(in srgb, var(--color-bg-deep) 65%, transparent)"
          }}
        />

        <div
          style={{
            position: "absolute",
            bottom: 0,

            width: 8,
            height: `${percent}%`,

            borderRadius: 999,

            background: color,

            boxShadow: `0 0 12px ${color}`
          }}
        />

        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value}
          aria-label={label}
          onChange={(event) => onChange?.(Number(event.target.value))}
          onPointerUp={(event) => onCommit?.(Number(event.currentTarget.value))}
          onKeyUp={(event) => onCommit?.(Number(event.currentTarget.value))}
          style={{
            position: "absolute",

            width: 120,
            height: 28,

            margin: 0,

            transform: "rotate(-90deg)",

            transformOrigin: "center",

            opacity: 0,

            cursor: "pointer"
          }}
        />

        <div
          style={{
            position: "absolute",

            bottom: `calc(${percent}% - 7px)`,

            width: 15,
            height: 15,

            borderRadius: "50%",

            background: color,

            boxShadow: `0 0 14px ${color}`,

            pointerEvents: "none"
          }}
        />
      </div>

      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color
        }}
      >
        {percent}%
      </span>
    </Stack>
  );
}

export default function MixerPanel({
  microphoneLevel,
  volumes,
  onVolumeChange,
  onMicrophoneCommit,
  microphoneEffects,
  onEffectChange
}) {
  const level = clamp(microphoneLevel, 0, 1);

  return (
    <Stack
      gap={0.5}
      style={{
        "--microphone-level": level
      }}
    >
      <Stack direction="row" align="center" gap={0.5}>
        <Mic size={16} />

        <strong>Микшер</strong>
      </Stack>

      <Stack
        direction="row"
        align="center"
        justify="space-around"
        gap={3}
        sx={{
          width: "100%",
          overflowX: "auto",

          /*
           * Было:
           * padding: "0.5rem 0"
           *
           * Оно ещё добавляло
           * 8px сверху и снизу.
           */
          padding: 0
        }}
      >
        {MIXER_FIELDS.flatMap(([key, label], index) => {
          const value = volumes[key] ?? 0;

          const effect = EFFECT_FIELDS[index];

          const items = [
            <VerticalSlider
              key={`mixer-${key}`}
              label={label}
              value={value}
              color={MIXER_COLORS[key] ?? "var(--color-primary)"}
              onChange={onVolumeChange[key]}
              onCommit={key === "microphone" ? onMicrophoneCommit : undefined}
            />
          ];

          if (effect) {
            const [effectKey, effectLabel, accent] = effect;

            items.push(
              <EffectDial
                key={`effect-${effectKey}`}
                label={effectLabel}
                value={microphoneEffects[effectKey]}
                accent={accent}
                onChange={(value) => onEffectChange(effectKey, value)}
              />
            );
          }

          return items;
        })}
      </Stack>
    </Stack>
  );
}
