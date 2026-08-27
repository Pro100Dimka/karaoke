import { Mic } from "lucide-react";
import { translateSaved as t } from "../../../../i18n/runtime";
import { Grid, RotaryKnob, Slider, Stack, Switch, Typography } from "../../../../theme/ui";
import { EFFECT_FIELDS, MIXER_FIELDS } from "./config";

export default function MixerPanel({
  microphoneLevel,
  volumes,
  onVolumeChange,
  onMicrophoneCommit,
  microphoneEffects,
  onEffectChange,
  monitoringEnabled,
  onMonitoringChange
}) {
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
        <Switch
          size="sm"
          variant="plain"
          label={t("Слышу себя")}
          checked={monitoringEnabled}
          onChange={onMonitoringChange}
        />
      </Stack>
      <Grid columns={4} gap="var(--space-2)" align="end">
        {MIXER_FIELDS.map(([key, label, accent], index) => {
          const [effectKey, effectLabel, effectAccent] = EFFECT_FIELDS[index];
          return (
            <Grid key={key} columns={2} gap="var(--space-1)" align="end">
              <Stack align="center" gap="var(--space-1)" sx={{ minInlineSize: 0 }}>
                <Typography variant="caption" noWrap style={{ color: accent }}>
                  {label}
                </Typography>
                <Slider
                  size="sm"
                  orientation="vertical"
                  aria-label={label}
                  min={0}
                  max={key === "microphone" ? 2 : 1}
                  step={0.05}
                  value={volumes[key] ?? 0}
                  showValue={false}
                  controlSx={{ blockSize: "var(--space-16)", minBlockSize: 0 }}
                  sx={{
                    touchAction: "none",
                    "--slider-fill": accent,
                    "--slider-fill-end": accent,
                    "--slider-thumb-border": accent
                  }}
                  onChange={onVolumeChange[key]}
                  onCommit={key === "microphone" ? onMicrophoneCommit : undefined}
                />
                <Typography variant="caption" style={{ color: accent }}>
                  {Math.round((volumes[key] ?? 0) * 100)}%
                </Typography>
              </Stack>
              <RotaryKnob
                label={effectLabel}
                value={microphoneEffects[effectKey] ?? 0}
                accent={effectAccent}
                onChange={(value) => onEffectChange(effectKey, value)}
              />
            </Grid>
          );
        })}
      </Grid>
    </Stack>
  );
}
