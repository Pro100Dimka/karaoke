import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Square
} from "lucide-react";
import Button from "../../../../components/fields/button";
import { IconButton } from "../../../../components/ui";
import { clamp } from "./utils";

function ControlButton({ icon, label, onClick }) {
  return icon ? (
    <IconButton
      icon={icon}
      label={label}
      size={17}
      unstyled
      onClick={onClick}
    />
  ) : (
    <Button unstyled aria-label={label} onClick={onClick}>
      {label.includes("Уменьшить") ? "−" : "+"}
    </Button>
  );
}

function PerformanceControls({
  song,
  currentTempo,
  compactKey,
  keyShift,
  onTempoChange,
  onKeyShiftChange
}) {
  const controls = [
    [
      "tempo",
      "Темп",
      `${currentTempo} BPM`,
      "",
      null,
      () => onTempoChange(-1),
      () => onTempoChange(1),
      "Уменьшить темп на 1 BPM",
      "Увеличить темп на 1 BPM"
    ],
    [
      "key",
      "Тональность",
      compactKey,
      "karaoke-performance-control--key",
      [ChevronLeft, ChevronRight],
      () => onKeyShiftChange(clamp(keyShift - 1, -12, 12)),
      () => onKeyShiftChange(clamp(keyShift + 1, -12, 12)),
      "Понизить тональность",
      "Повысить тональность"
    ]
  ];
  const noteRange = `${song.note_range_min || "C2"} – ${
    song.note_range_max || "C5"
  }`;
  return (
    <div className="karaoke-performance-controls">
      {controls.map(
        ([
          id,
          label,
          value,
          modifier,
          icons,
          onDecrease,
          onIncrease,
          decreaseLabel,
          increaseLabel
        ]) => (
          <div
            key={id}
            className={`karaoke-performance-control ${modifier}`.trim()}
          >
            <span>{label}</span>
            <ControlButton
              icon={icons?.[0]}
              label={decreaseLabel}
              onClick={onDecrease}
            />
            <strong>{value}</strong>
            <ControlButton
              icon={icons?.[1]}
              label={increaseLabel}
              onClick={onIncrease}
            />
          </div>
        )
      )}

      <div className="karaoke-performance-control karaoke-performance-control--range">
        <span>Диапазон</span>
        <strong>{noteRange}</strong>
      </div>
    </div>
  );
}

function TransportButtons({ isPlaying, onSkip, onTogglePlay, onStop }) {
  const buttons = [
    [
      "skip-back",
      SkipBack,
      "Назад на 5 секунд",
      22,
      "btn btn-ghost karaoke-transport-button",
      () => onSkip(-5)
    ],
    [
      "play",
      isPlaying ? Pause : Play,
      isPlaying ? "Пауза" : "Воспроизвести",
      30,
      "btn btn-primary karaoke-play-button",
      onTogglePlay
    ],
    [
      "stop",
      Square,
      "Остановить",
      20,
      "btn btn-ghost karaoke-transport-button",
      onStop
    ],
    [
      "skip-forward",
      SkipForward,
      "Вперёд на 5 секунд",
      22,
      "btn btn-ghost karaoke-transport-button",
      () => onSkip(5)
    ]
  ];

  return (
    <div className="karaoke-transport-buttons karaoke-transport-buttons--hero">
      {buttons.map(([id, icon, label, size, className, onClick]) => (
        <IconButton
          key={id}
          icon={icon}
          label={label}
          size={size}
          className={className}
          unstyled
          onClick={onClick}
        />
      ))}
    </div>
  );
}

export default function ConsoleCenter(props) {
  return (
    <section className="karaoke-console-center">
      <TransportButtons {...props} />
      <PerformanceControls {...props} />
    </section>
  );
}
