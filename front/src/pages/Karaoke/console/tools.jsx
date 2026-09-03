import { AudioLines, Cog, MousePointer2, Type } from "lucide-react";
import { translateSaved as t } from "../../../i18n/runtime";
import { Button, Grid, Stack } from "../../../theme/ui";
import { EFFECT_PRESETS } from "../constants";
import { normalizePreset } from "./utils";

const presets = EFFECT_PRESETS.map(normalizePreset);

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
    [AudioLines, "karaoke.sheetMusic", showNotes, onToggleNotes],
    [Type, "karaoke.text", showLyrics, onToggleLyrics],
    [
      MousePointer2,
      "karaoke.autohide",
      autoHideEnabled,
      onAutoHideChange && (() => onAutoHideChange(!autoHideEnabled))
    ],
    [Cog, "karaoke.settings", null, onOpenAppSettings]
  ].filter((tool) => tool[3]);
  return (
    <Stack justify="space-between" gap="var(--space-2)">
      <Grid columns={tools.length} gap="var(--space-1)">
        {tools.map(([Icon, label, active, onClick]) => (
          <Button
            key={label}
            variant={active ? "contained" : "outlined"}
            tone={active ? "success" : "primary"}
            startIcon={<Icon />}
            aria-pressed={typeof active === "boolean" ? active : undefined}
            onClick={onClick}
          >
            {t(label)}
          </Button>
        ))}
      </Grid>
      <Grid columns={4} gap="var(--space-1)">
        {presets.map(([id, label, symbol, echo, reverb, delay]) => (
          <Button
            key={id}
            variant={effectPreset === id ? "contained" : "outlined"}
            aria-pressed={effectPreset === id}
            title={t("karaoke.echoReverb", {
              0: label,
              1: Math.round(echo * 100),
              2: Math.round(reverb * 100)
            })}
            onClick={() => onApplyEffectPreset?.({ id, label, symbol, echo, reverb, delay })}
          >
            {symbol} {label}
          </Button>
        ))}
      </Grid>
    </Stack>
  );
}
