import { Mic } from "lucide-react";
import { translateSaved as t } from "../../../../i18n/runtime";
import { RangeInput, RotaryKnob, Stack, Typography } from "../../../../theme/ui";
import { EFFECT_FIELDS, MIXER_FIELDS } from "./config";
import { clamp } from "./utils";

const MIXER_COLORS = {
  microphone: "var(--color-primary)",
  music: "var(--color-success)",
  vocal: "var(--color-warning)",
  melody: "var(--color-secondary)"
};

const TRACK_STYLE = {
  position: "absolute",
  width: 6,
  height: "100%",
  borderRadius: 999,
  background: "color-mix(in srgb, var(--color-surface-strong) 76%, var(--color-bg-deep))",
  border: "1px solid color-mix(in srgb, var(--color-border-strong) 55%, transparent)",
  boxShadow: "inset 0 0 0.4rem color-mix(in srgb, var(--color-bg-deep) 72%, transparent)"
};

const INPUT_STYLE = {
  position: "absolute",
  width: 116,
  height: 26,
  margin: 0,
  transform: "rotate(-90deg)",
  transformOrigin: "center",
  opacity: 0,
  cursor: "pointer",
  touchAction: "none"
};

const LABEL_STYLE = { fontWeight: 800, lineHeight: 1 };

function VerticalSlider({ label, value, color, onChange, onCommit, max = 1 }) {
  const percent = Math.round(value * 100);
  const fill = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <Stack gap={0.45} sx={{ userSelect: "none", width: "auto" }}>
      <Typography
        variant="caption"
        sx={{ ...LABEL_STYLE, color, fontSize: 10.5, whiteSpace: "nowrap" }}
      >
        {label}
      </Typography>
      <Stack style={{ height: 80, position: "relative" }}>
        <div aria-hidden style={TRACK_STYLE} />
        <div
          aria-hidden
          style={{
            ...TRACK_STYLE,
            bottom: 0,
            height: `${fill}%`,
            background: color,
            border: 0,
            boxShadow: `0 0 0.7rem ${color}`
          }}
        />
        <RangeInput
          min={0}
          max={max}
          step={0.05}
          value={value}
          aria-label={label}
          aria-valuetext={`${percent}%`}
          onChange={onChange}
          onCommit={onCommit}
          style={INPUT_STYLE}
        />
        <div
          aria-hidden
          style={{
            position: "absolute",
            bottom: `clamp(0px, calc(${fill}% - 7px), calc(100% - 14px))`,
            width: 14,
            height: 14,
            border: `1px solid color-mix(in srgb, ${color} 78%, white)`,
            borderRadius: "50%",
            background: color,
            boxShadow: `0 0 0.8rem ${color}`,
            pointerEvents: "none"
          }}
        />
      </Stack>
      <Typography variant="caption" sx={{ ...LABEL_STYLE, color, fontSize: 10 }}>
        {percent}%
      </Typography>
    </Stack>
  );
}

export default function MixerPanel(props) {
  const {
    microphoneLevel,
    volumes,
    onVolumeChange,
    onMicrophoneCommit,
    microphoneEffects,
    onEffectChange
  } = props;
  const level = clamp(microphoneLevel, 0, 1);
  return (
    <Stack gap="1rem" style={{ "--microphone-level": level }}>
      <Stack direction="row" align="center" gap={0.4}>
        <Mic size={15} strokeWidth={2.2} />
        <Typography
          variant="caption"
          sx={{
            color: "var(--color-text)",
            fontSize: 11.5,
            fontWeight: 850,
            lineHeight: 1
          }}
        >
          {t("Микшер")}
        </Typography>
      </Stack>
      <Stack direction="row" align="center" justify="space-between">
        {MIXER_FIELDS.flatMap(([key, label], index) => {
          const effect = EFFECT_FIELDS[index];
          return [
            <VerticalSlider
              key={key}
              label={label}
              value={volumes[key] ?? 0}
              color={MIXER_COLORS[key]}
              onChange={onVolumeChange[key]}
              onCommit={key === "microphone" ? onMicrophoneCommit : undefined}
              max={key === "microphone" ? 2 : 1}
            />,
            effect && (
              <RotaryKnob
                key={effect[0]}
                label={effect[1]}
                value={microphoneEffects[effect[0]]}
                accent={effect[2]}
                onChange={(value) => onEffectChange(effect[0], value)}
              />
            )
          ].filter(Boolean);
        })}
      </Stack>
    </Stack>
  );
}
