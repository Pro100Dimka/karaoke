import { Fragment } from "react";
import { Mic } from "lucide-react";
import { translateSaved as t } from "../../../i18n/runtime";
import { Grid, RotaryKnob, Slider, Stack, Switch, Typography } from "../../../theme/ui";
import { EFFECT_FIELDS, MIXER_FIELDS } from "./config";

const percent = (value) => Math.round((Number(value) || 0) * 100);

export default function MixerPanel({
  microphoneLevel,
  volumes = {},
  onVolumeChange = {},
  onVolumeCommit = {},
  microphoneEffects = {},
  onEffectChange,
  onEffectCommit,
  monitoringEnabled,
  onMonitoringChange
}) {
  return (
    <Stack gap="var(--space-2)">
      <Stack direction="row" align="center" gap="var(--space-2)">
        <Mic aria-hidden />
        <Typography variant="caption">
          <strong>{t("karaoke.mixer")}</strong>
        </Typography>
        <Typography variant="caption" tone="muted">
          {percent(Math.max(0, Math.min(1, Number(microphoneLevel) || 0)))}%
        </Typography>
        <Switch
          size="sm"
          variant="plain"
          label={t("karaoke.iHearMyself")}
          checked={!!monitoringEnabled}
          onChange={onMonitoringChange}
        />
      </Stack>

      <Grid columns={EFFECT_FIELDS.length + MIXER_FIELDS.length} gap="var(--space-2)" align="end">
        {EFFECT_FIELDS.map(
          ([effect, label, accent, min = 0, max = 1, step, displayFactor], index) => {
            const mixer = MIXER_FIELDS[index];

            return (
              <Fragment key={effect}>
                <RotaryKnob
                  label={label}
                  min={min}
                  max={max}
                  step={step}
                  value={microphoneEffects[effect] ?? 0}
                  displayFactor={displayFactor}
                  accent={accent}
                  onChange={(value) => onEffectChange?.(effect, value)}
                  onCommit={(value) => onEffectCommit?.(effect, value)}
                />

                {mixer && (
                  <Stack align="center" gap="var(--space-1)">
                    <Typography variant="caption" noWrap style={{ color: mixer[2] }}>
                      {mixer[1]}
                    </Typography>
                    <Slider
                      size="sm"
                      orientation="vertical"
                      aria-label={mixer[1]}
                      min={0}
                      max={mixer[0] === "microphone" ? 2 : 1}
                      step={0.05}
                      value={volumes[mixer[0]] ?? 0}
                      showValue={false}
                      controlSx={{ blockSize: "var(--space-16)", minBlockSize: 0 }}
                      onChange={onVolumeChange[mixer[0]]}
                      onCommit={onVolumeCommit[mixer[0]]}
                    />
                    <Typography variant="caption" style={{ color: mixer[2] }}>
                      {percent(volumes[mixer[0]])}%
                    </Typography>
                  </Stack>
                )}
              </Fragment>
            );
          }
        )}
      </Grid>
    </Stack>
  );
}
