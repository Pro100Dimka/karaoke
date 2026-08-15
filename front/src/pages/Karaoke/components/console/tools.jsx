import { AudioLines, Cog, Ear, MousePointer2, Type } from "lucide-react";
import { translateSaved } from "../../../../i18n/runtime";
import { Button, Grid, Stack, Typography } from "../../../../theme/ui";
import { EFFECT_PRESETS } from "../../constants";
import { normalizePreset } from "./utils";

const PRESET_ACCENTS = {
  hall: "var(--color-primary)",
  room: "var(--color-success)",
  plate: "var(--color-warning)",
  studio: "var(--color-secondary)",
  classic: "var(--color-primary)",
  pop: "var(--color-success)",
  rock: "var(--color-warning)",
  club: "var(--color-secondary)"
};
const TOOL_BUTTON_SX = {
  minHeight: 38,
  padding: "0.45rem 0.75rem",
  borderRadius: "var(--shape-md)",
  color: "var(--color-text-soft)",
  border:
    "1px solid color-mix(in srgb, var(--color-primary) 38%, var(--color-border))",
  background: "color-mix(in srgb, var(--color-bg-deep) 88%, transparent)",
  boxShadow:
    "inset 0 1px 0 color-mix(in srgb, var(--color-highlight) 5%, transparent)",
  transition:
    "transform 140ms ease, color 140ms ease, border-color 140ms ease, background 140ms ease, box-shadow 140ms ease"
};
function EffectPreset({ id, label, symbol, echo, reverb, active, onClick }) {
  const accent = PRESET_ACCENTS[id];
  return (
    <Button
      variant="ghost"
      aria-pressed={active}
      title={translateSaved("{0}: эхо {1}%, реверб {2}%", {
        0: label,
        1: Math.round(echo * 100),
        2: Math.round(reverb * 100)
      })}
      onClick={onClick}
      sx={{
        minWidth: 0,
        minHeight: 62,
        padding: "0.4rem 0.45rem",
        display: "grid",
        placeItems: "center",
        borderRadius: "var(--shape-lg)",
        color: active ? "var(--preset-accent)" : "var(--color-text-soft)",
        border: active
          ? "1px solid var(--preset-accent)"
          : "1px solid color-mix(in srgb, var(--preset-accent) 42%, var(--color-border))",
        background: active
          ? "linear-gradient(180deg, color-mix(in srgb, var(--preset-accent) 13%, var(--color-bg-deep)), var(--color-bg-deep))"
          : "color-mix(in srgb, var(--color-bg-deep) 90%, transparent)",
        boxShadow: active
          ? "0 0 1rem color-mix(in srgb, var(--preset-accent) 24%, transparent), inset 0 1px 0 color-mix(in srgb, var(--color-highlight) 7%, transparent)"
          : "inset 0 1px 0 color-mix(in srgb, var(--color-highlight) 4%, transparent)"
      }}
      style={{ "--preset-accent": accent }}
    >
      <Stack align="center">
        <span
          aria-hidden="true"
          style={{
            display: "grid",
            placeItems: "center",
            minWidth: 30,
            minHeight: 30,
            color: accent,
            fontSize: 24,
            lineHeight: 1,
            filter: active
              ? `drop-shadow(
                  0 0 0.45rem
                  color-mix(
                    in srgb,
                    ${accent} 55%,
                    transparent
                  )
                )`
              : "none"
          }}
        >
          {symbol}
        </span>

        <Typography
          variant="caption"
          sx={{
            color: active ? accent : "var(--color-text-soft)",
            fontSize: 11,
            fontWeight: 800,
            lineHeight: 1,
            whiteSpace: "nowrap"
          }}
        >
          {label}
        </Typography>
      </Stack>
    </Button>
  );
}
function EffectPresets({ effectPreset, onApplyEffectPreset }) {
  return (
    <Grid
      columns={4}
      gap="0.5rem"
      sx={{ width: "100%" }}
    >
      {EFFECT_PRESETS.map(normalizePreset).map(
        ([id, label, symbol, echo, reverb, delay]) => {
          const preset = {
            id,
            label,
            symbol,
            echo,
            reverb,
            delay
          };
          return (
            <EffectPreset
              key={id}
              id={id}
              label={label}
              symbol={symbol}
              echo={echo}
              reverb={reverb}
              active={effectPreset === id}
              onClick={() => onApplyEffectPreset?.(preset)}
            />
          );
        }
      )}
    </Grid>
  );
}
function ToolButton({ icon: Icon, label, active, title, onClick }) {
  return (
    <Button
      variant="ghost"
      aria-pressed={typeof active === "boolean" ? active : undefined}
      title={title}
      onClick={onClick}
      sx={{
        ...TOOL_BUTTON_SX,
        flex: "1 1 0",
        color: active ? "var(--color-success)" : "var(--color-text-soft)",
        borderColor: active
          ? "color-mix(in srgb, var(--color-success) 70%, var(--color-border))"
          : "color-mix(in srgb, var(--color-primary) 38%, var(--color-border))",
        background: active
          ? "linear-gradient(180deg, color-mix(in srgb, var(--color-success) 10%, var(--color-bg-deep)), var(--color-bg-deep))"
          : "color-mix(in srgb, var(--color-bg-deep) 90%, transparent)",
        boxShadow: active
          ? "0 0 0.9rem color-mix(in srgb, var(--color-success) 25%, transparent), inset 0 1px 0 color-mix(in srgb, var(--color-highlight) 7%, transparent)"
          : "inset 0 1px 0 color-mix(in srgb, var(--color-highlight) 4%, transparent)"
      }}
    >
      <Stack direction="row" align="center" justify="center" gap={0.6}>
        <Icon size={16} strokeWidth={2} aria-hidden="true" />

        <Typography
          variant="caption"
          sx={{ color: "inherit", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}
        >
          {label}
        </Typography>
      </Stack>
    </Button>
  );
}
function ToolTabs({
  showNotes,
  showLyrics,
  onToggleNotes,
  onToggleLyrics,
  onOpenAppSettings,
  monitoringEnabled,
  onMonitoringChange,
  autoHideEnabled,
  onAutoHideChange
}) {
  const tools = [
    ["notes", AudioLines, translateSaved("Ноты"), showNotes, onToggleNotes],
    ["lyrics", Type, translateSaved("Текст"), showLyrics, onToggleLyrics],
    [
      "monitor",
      Ear,
      translateSaved("Слышу себя"),
      monitoringEnabled,
      () => onMonitoringChange?.(!monitoringEnabled),
      translateSaved( "Независимое прослушивание микрофона с выбранными эффектами"
      )
    ],
    [
      "auto",
      MousePointer2,
      translateSaved("Автоскрытие"),
      autoHideEnabled,
      () => onAutoHideChange?.(!autoHideEnabled),
      translateSaved( "Автоматически показывать и скрывать консоль при движении мыши"
      )
    ],
    ["settings", Cog, translateSaved("Настройки"), null, onOpenAppSettings]
  ].filter(([, , , , onClick]) => onClick);
  return (
    <Stack
      direction="row"
      gap={0.5}
      sx={{ width: "100%" }}
    >
      {tools.map(([id, Icon, label, active, onClick, title]) => (
        <ToolButton
          key={id}
          icon={Icon}
          label={label}
          active={active}
          title={title}
          onClick={onClick}
        />
      ))}
    </Stack>
  );
}
export default function ToolsPanel(props) {
  return (
    <Stack gap={0.75} justify="flex-end">
      <ToolTabs {...props} />
      <EffectPresets {...props} />
    </Stack>
  );
}
