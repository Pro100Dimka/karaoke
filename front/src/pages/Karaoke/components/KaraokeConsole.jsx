import {
  ArrowLeft,
  AudioLines,
  Cog,
  ChevronLeft,
  ChevronRight,
  Mic,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Square,
  Type
} from "lucide-react";
import Button from "../../../components/fields/button";
import { IconButton } from "../../../components/ui";
import { EFFECT_PRESETS } from "../constants";
import { formatTime } from "../utils/format";
import EffectDial from "./EffectDial";
import SliderField from "./SliderField";
import WaveformTimeline from "./WaveformTimeline";

const MIXER_FIELDS = [
  { key: "microphone", label: "Мик" },
  { key: "music", label: "Музыка" },
  { key: "vocal", label: "Вокал" },
  { key: "melody", label: "Мелодия" }
];

export default function KaraokeConsole({
  song,
  currentTime,
  duration,
  microphoneLevel,
  volumes,
  onVolumeChange,
  onMicrophoneCommit,
  microphoneEffects,
  onEffectChange,
  isPlaying,
  onSkip,
  onTogglePlay,
  onStop,
  currentTempo,
  onTempoChange,
  compactKey,
  keyShift,
  onKeyShiftChange,
  microphoneOpen,
  microphoneSettingsView,
  onOpenEffects,
  showNotes,
  onToggleNotes,
  showLyrics,
  onToggleLyrics,
  onReturn,
  onOpenAppSettings,
  effectPreset,
  onApplyEffectPreset,
  onSeek
}) {
  const tools = [
    {
      id: "effects",
      icon: AudioLines,
      label: "Эффекты",
      active: microphoneOpen && microphoneSettingsView === "effects",
      onClick: onOpenEffects
    },
    {
      id: "notes",
      icon: AudioLines,
      label: "Ноты",
      active: showNotes,
      onClick: onToggleNotes
    },
    {
      id: "lyrics",
      icon: Type,
      label: "Текст",
      active: showLyrics,
      onClick: onToggleLyrics
    },
    { id: "back", icon: ArrowLeft, label: "Назад", onClick: onReturn },
    ...(onOpenAppSettings
      ? [{ id: "settings", icon: Cog, label: "Настройки", onClick: () => onOpenAppSettings() }]
      : [])
  ];

  return (
    <div className="karaoke-transport-area karaoke-studio-console">
      <div className="karaoke-song-strip">
        <div className="karaoke-song-cover" aria-hidden="true">
          <Mic size={30} />
        </div>
        <div className="karaoke-player-meta">
          <strong>{song.title}</strong>
          <span>{song.artist || song.performer || "Караоке"}</span>
        </div>
        <span className="mono karaoke-timecode">{formatTime(currentTime)}</span>
        <WaveformTimeline value={currentTime} duration={duration} onChange={onSeek} />
        <span className="mono karaoke-timecode karaoke-timecode-end">
          {formatTime(duration)}
        </span>
      </div>

      <div className="karaoke-console-grid">
        <section
          className="karaoke-console-panel karaoke-mixer-panel"
          style={{ "--microphone-level": Math.max(0, Math.min(1, microphoneLevel)) }}
        >
          <div className="karaoke-console-title">
            <Mic size={18} />
            <strong>Микшер</strong>
            <span className="karaoke-microphone-meter" aria-hidden="true">
              {Array.from({ length: 7 }, (_, index) => (
                <i
                  key={index}
                  style={{
                    "--meter-level": `${Math.max(
                      18,
                      Math.min(100, microphoneLevel * 100 - index * 6 + 34)
                    )}%`
                  }}
                />
              ))}
            </span>
          </div>
          <div className="karaoke-mixer-body">
            <div className="karaoke-quick-mixer karaoke-quick-mixer--vertical">
              {MIXER_FIELDS.map(({ key, label }) => (
                <SliderField
                  key={key}
                  label={label}
                  value={volumes[key]}
                  min={0}
                  max={1}
                  step={0.05}
                  display={`${Math.round(volumes[key] * 100)}%`}
                  onChange={onVolumeChange[key]}
                  onCommit={key === "microphone" ? onMicrophoneCommit : undefined}
                />
              ))}
            </div>
            <div className="karaoke-mixer-effects" aria-label="Быстрые эффекты микрофона">
              <EffectDial
                label="Эхо"
                value={microphoneEffects.echo}
                onChange={(value) => onEffectChange("echo", value)}
              />
              <EffectDial
                label="Реверб"
                value={microphoneEffects.reverb}
                accent="secondary"
                onChange={(value) => onEffectChange("reverb", value)}
              />
            </div>
          </div>
        </section>

        <section className="karaoke-console-center">
          <div className="karaoke-transport-buttons karaoke-transport-buttons--hero">
            <IconButton
              icon={SkipBack}
              label="Назад на 5 секунд"
              size={22}
              className="btn btn-ghost karaoke-transport-button"
              unstyled
              onClick={() => onSkip(-5)}
            />
            <IconButton
              icon={isPlaying ? Pause : Play}
              label={isPlaying ? "Пауза" : "Воспроизвести"}
              size={30}
              className="btn btn-primary karaoke-play-button"
              unstyled
              onClick={onTogglePlay}
            />
            <IconButton
              icon={Square}
              label="Остановить"
              size={20}
              className="btn btn-ghost karaoke-transport-button"
              unstyled
              onClick={onStop}
            />
            <IconButton
              icon={SkipForward}
              label="Вперёд на 5 секунд"
              size={22}
              className="btn btn-ghost karaoke-transport-button"
              unstyled
              onClick={() => onSkip(5)}
            />
          </div>
          <div className="karaoke-performance-controls">
            <div className="karaoke-performance-control">
              <span>Темп</span>
              <Button unstyled aria-label="Уменьшить темп на 1 BPM" onClick={() => onTempoChange(-1)}>−</Button>
              <strong>{currentTempo} BPM</strong>
              <Button unstyled aria-label="Увеличить темп на 1 BPM" onClick={() => onTempoChange(1)}>+</Button>
            </div>
            <div className="karaoke-performance-control karaoke-performance-control--key">
              <span>Тональность</span>
              <IconButton
                icon={ChevronLeft}
                label="Понизить тональность"
                size={17}
                unstyled
                onClick={() => onKeyShiftChange(Math.max(-12, keyShift - 1))}
              />
              <strong>{compactKey}</strong>
              <IconButton
                icon={ChevronRight}
                label="Повысить тональность"
                size={17}
                unstyled
                onClick={() => onKeyShiftChange(Math.min(12, keyShift + 1))}
              />
            </div>
            <div className="karaoke-performance-control karaoke-performance-control--range">
              <span>Диапазон</span>
              <strong>{song.note_range_min || "C2"} – {song.note_range_max || "C5"}</strong>
            </div>
          </div>
        </section>

        <section className="karaoke-console-panel karaoke-tools-panel">
          <div className="karaoke-tool-tabs">
            {tools.map(({ id, icon: Icon, label, active, onClick }) => (
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
          <div className="karaoke-effect-presets" aria-label="Режимы эффектов микрофона">
            {EFFECT_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                unstyled
                className={effectPreset === preset.id ? "is-active" : ""}
                onClick={() => onApplyEffectPreset(preset)}
                aria-pressed={effectPreset === preset.id}
                title={`${preset.label}: эхо ${Math.round(preset.echo * 100)}%, реверб ${Math.round(preset.reverb * 100)}%`}
              >
                <span aria-hidden="true">{preset.symbol}</span>
                <small>{preset.label}</small>
              </Button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
