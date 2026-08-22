import { Mic } from "lucide-react";
import { translateSaved as t } from "../../../../i18n/runtime";
import { Grid, RotaryKnob, Slider, Stack, Typography } from "../../../../theme/ui";
import { EFFECT_FIELDS, MIXER_FIELDS } from "./config";

export default function MixerPanel({
  microphoneLevel,
  volumes,
  onVolumeChange,
  onMicrophoneCommit,
  microphoneEffects,
  onEffectChange
}) {
  const controls = MIXER_FIELDS.flatMap((field, index) => [
    ["volume", ...field],
    ["effect", ...EFFECT_FIELDS[index]]
  ]);
  return (
    <Stack gap="var(--space-2)">
      <Stack direction="row" align="center" gap="var(--space-2)">
        <Mic aria-hidden="true" />
        <Typography variant="caption">
          <strong>{t("Микшер")}</strong>
        </Typography>
        <Typography variant="caption" tone="muted">
          {Math.round(Math.max(0, Math.min(1, microphoneLevel)) * 100)}%
        </Typography>
      </Stack>
      <Grid columns={8} gap="var(--space-1)" align="end">
        {controls.map(([type, key, label, accent]) =>
          type === "volume" ? (
            <Stack key={key} align="center" gap="var(--space-1)" sx={{ minInlineSize: 0 }}>
              <Typography variant="caption" noWrap style={{ color: accent }}>
                {label}
              </Typography>
              <Slider
                size="sm"
                aria-label={label}
                min={0}
                max={key === "microphone" ? 2 : 1}
                step={0.05}
                value={volumes[key] ?? 0}
                showValue={false}
                sx={{ touchAction: "none", "--color-accent": accent }}
                onChange={onVolumeChange[key]}
                onCommit={key === "microphone" ? onMicrophoneCommit : undefined}
              />
              <Typography variant="caption" style={{ color: accent }}>
                {Math.round((volumes[key] ?? 0) * 100)}%
              </Typography>
            </Stack>
          ) : (
            <RotaryKnob
              key={key}
              label={label}
              value={microphoneEffects[key] ?? 0}
              accent={accent}
              onChange={(value) => onEffectChange(key, value)}
            />
          )
        )}
      </Grid>
    </Stack>
  );
}
