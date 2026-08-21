import { Mic } from "lucide-react";
import { RotaryKnob } from "../../../../components/fields";
import { translateSaved } from "../../../../i18n/runtime";
import { Stack, Typography } from "../../../../theme/ui";
import { EFFECT_FIELDS, MIXER_FIELDS } from "./config";
import { clamp } from "./utils";

const MIXER_COLORS = {
  microphone: "var(--color-primary)",
  music: "var(--color-success)",
  vocal: "var(--color-warning)",
  melody: "var(--color-secondary)"
};
function VerticalSlider({ label, value, color, onChange, onCommit, max = 1 }) {
  const percent = Math.round(value * 100);
  const fillPercent = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <Stack gap={0.45} sx={{ userSelect: "none", width: "auto" }}>
      <Typography
        variant="caption"
        sx={{ color, fontSize: 10.5, fontWeight: 800, lineHeight: 1, whiteSpace: "nowrap" }}
      >
        {label}
      </Typography>

      <div
        style={{
          position: "relative",
          width: 26,
          height: 116,
          display: "grid",
          placeItems: "center"
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            width: 6,
            height: "100%",
            borderRadius: 999,
            background: "color-mix(in srgb, var(--color-surface-strong) 76%, var(--color-bg-deep))",
            border: "1px solid color-mix(in srgb, var(--color-border-strong) 55%, transparent)",
            boxShadow: "inset 0 0 0.4rem color-mix(in srgb, var(--color-bg-deep) 72%, transparent)"
          }}
        />

        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: 0,
            width: 6,
            height: `${fillPercent}%`,
            borderRadius: 999,
            background: color,
            boxShadow: `0 0 0.7rem ${color}`
          }}
        />

        <input
          type="range"
          min={0}
          max={max}
          step={0.05}
          value={value}
          aria-label={label}
          aria-valuetext={`${percent}%`}
          onChange={(event) => onChange?.(Number(event.target.value))}
          onPointerUp={(event) => onCommit?.(Number(event.currentTarget.value))}
          onKeyUp={(event) => onCommit?.(Number(event.currentTarget.value))}
          style={{
            position: "absolute",
            width: 116,
            height: 26,
            margin: 0,
            transform: "rotate(-90deg)",
            transformOrigin: "center",
            opacity: 0,
            cursor: "pointer",
            // The input's own drag axis is horizontal (rotation is a paint-only
            // transform); browsers compute touch/pen gesture routing from the
            // pre-rotation layout, so the default "auto" touch-action lets a
            // vertical drag on this rotated thumb be claimed as a page pan
            // instead of a slider drag. Claim the gesture exclusively so only
            // the value changes, never the surrounding interface.
            touchAction: "none"
          }}
        />

        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: `clamp(0px, calc(${fillPercent}% - 7px), calc(100% - 14px))`,
            width: 14,
            height: 14,
            border: `1px solid color-mix(in srgb, ${color} 78%, white)`,
            borderRadius: "50%",
            background: color,
            boxShadow: `0 0 0.8rem ${color}`,
            pointerEvents: "none"
          }}
        />
      </div>

      <Typography variant="caption" sx={{ color, fontSize: 10, fontWeight: 800, lineHeight: 1 }}>
        {percent}%
      </Typography>
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
    <Stack gap="1rem" style={{ "--microphone-level": level }}>
      <Stack direction="row" align="center" gap={0.4}>
        <Mic size={15} strokeWidth={2.2} />
        <Typography
          variant="caption"
          sx={{ color: "var(--color-text)", fontSize: 11.5, fontWeight: 850, lineHeight: 1 }}
        >
          {translateSaved("Микшер")}
        </Typography>
      </Stack>
      <Stack direction="row" align="center" justify="space-between">
        {MIXER_FIELDS.flatMap(([key, label], index) => {
          const value = volumes[key] ?? 0;
          const effect = EFFECT_FIELDS[index];
          const items = [
            <VerticalSlider
              key={`mixer-${key}`}
              label={label}
              value={value}
              color={MIXER_COLORS[key]}
              onChange={onVolumeChange[key]}
              onCommit={key === "microphone" ? onMicrophoneCommit : undefined}
              max={key === "microphone" ? 2 : 1}
            />
          ];
          if (effect) {
            const [effectKey, effectLabel, accent] = effect;
            items.push(
              <RotaryKnob
                key={`effect-${effectKey}`}
                label={effectLabel}
                value={microphoneEffects[effectKey]}
                accent={accent}
                onChange={(nextValue) => onEffectChange(effectKey, nextValue)}
              />
            );
          }
          return items;
        })}
      </Stack>
    </Stack>
  );
}
