import { AudioLines, Cog, MousePointer2, Type } from "lucide-react";
import { translateSaved as t } from "../../../../i18n/runtime";
import { Button, Grid, Stack } from "../../../../theme/ui";
import { EFFECT_PRESETS } from "../../constants";
import { normalizePreset } from "./utils";

export default function ToolsPanel({
  showNotes,
  showLyrics,
  onToggleNotes,
  onToggleLyrics,
  onOpenAppSettings,
  autoHideEnabled,
  onAutoHideChange,
  effectPreset,
  onApplyEffectPreset
}) {
  const tools = [
    [AudioLines, t("Ноты"), showNotes, onToggleNotes],
    [Type, t("Текст"), showLyrics, onToggleLyrics],
    [MousePointer2, t("Автоскрытие"), autoHideEnabled, () => onAutoHideChange?.(!autoHideEnabled)],
    [Cog, t("Настройки"), null, onOpenAppSettings]
  ].filter(([, , , action]) => action);
  return (
    <Stack justify="space-between" gap="var(--space-2)">
      <Grid columns={tools.length} gap="var(--space-1)">
        {tools.map(([Icon, label, active, action]) => (
          <Button
            key={label}
            variant={active ? "contained" : "outlined"}
            tone={active ? "success" : "primary"}
            startIcon={<Icon />}
            aria-pressed={typeof active === "boolean" ? active : undefined}
            onClick={action}
          >
            {label}
          </Button>
        ))}
      </Grid>
      <Grid columns={4} gap="var(--space-1)">
        {EFFECT_PRESETS.map(normalizePreset).map(([id, label, symbol, echo, reverb, delay]) => (
          <Button
            key={id}
            variant={effectPreset === id ? "contained" : "outlined"}
            title={t("{0}: эхо {1}%, реверб {2}%", {
              0: label,
              1: Math.round(echo * 100),
              2: Math.round(reverb * 100)
            })}
            aria-pressed={effectPreset === id}
            onClick={() => onApplyEffectPreset?.({ id, label, symbol, echo, reverb, delay })}
          >
            {symbol} {label}
          </Button>
        ))}
      </Grid>
    </Stack>
  );
}
