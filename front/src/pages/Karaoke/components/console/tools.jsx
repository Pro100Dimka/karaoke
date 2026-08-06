import { ArrowLeft, AudioLines, Cog, Type } from "lucide-react";
import Button from "../../../../components/fields/button";
import { EFFECT_PRESETS } from "../../constants";
import { normalizePreset } from "./utils";

function EffectPresets({ activePreset, onApply }) {
  return (
    <div
      className="karaoke-effect-presets"
      aria-label="Режимы эффектов микрофона"
    >
      {EFFECT_PRESETS.map(normalizePreset).map(
        ([id, label, symbol, echo, reverb]) => {
          const active = activePreset === id;
          const preset = [id, label, symbol, echo, reverb];
          return (
            <Button
              key={id}
              unstyled
              className={active ? "is-active" : ""}
              aria-pressed={active}
              title={`${label}: эхо ${Math.round(
                echo * 100
              )}%, реверб ${Math.round(reverb * 100)}%`}
              onClick={() => onApply(preset)}
            >
              <span aria-hidden="true">{symbol}</span>
              <small>{label}</small>
            </Button>
          );
        }
      )}
    </div>
  );
}

function ToolTabs({
  microphoneOpen,
  microphoneSettingsView,
  showNotes,
  showLyrics,
  onOpenEffects,
  onToggleNotes,
  onToggleLyrics,
  onReturn,
  onOpenAppSettings
}) {
  const tools = [
    ["back", ArrowLeft, "Назад", null, onReturn],
    [
      "effects",
      AudioLines,
      "Эффекты",
      microphoneOpen && microphoneSettingsView === "effects",
      onOpenEffects
    ],
    ["notes", AudioLines, "Ноты", showNotes, onToggleNotes],
    ["lyrics", Type, "Текст", showLyrics, onToggleLyrics],
    ["settings", Cog, "Настройки", null, onOpenAppSettings]
  ].filter(([, , , , onClick]) => onClick);

  return (
    <div className="karaoke-tool-tabs">
      {tools.map(([id, Icon, label, active, onClick]) => (
        <Button
          key={id}
          unstyled
          className={active ? "is-active" : ""}
          aria-pressed={typeof active === "boolean" ? active : undefined}
          onClick={onClick}
        >
          <Icon size={17} />
          <span>{label}</span>
        </Button>
      ))}
    </div>
  );
}

export default function ToolsPanel(props) {
  return (
    <section className="karaoke-console-panel karaoke-tools-panel">
      <ToolTabs {...props} />
      <EffectPresets
        activePreset={props.effectPreset}
        onApply={props.onApplyEffectPreset}
      />
    </section>
  );
}
