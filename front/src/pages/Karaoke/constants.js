import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Square
} from "lucide-react";
import { translateSaved as tr } from "../../i18n/runtime";
import { clamp } from "../../utils/math";

export const EFFECT_PRESETS = [
  {
    id: "classic",
    label: tr("karaoke.classic"),
    symbol: "♬",
    reverb: 0.64,
    echo: 0.18,
    delay: 0.12
  },
  { id: "hall", label: tr("karaoke.hall"), symbol: "⌗", reverb: 0.72, echo: 0.22, delay: 0.16 },
  { id: "room", label: tr("karaoke.room"), symbol: "◇", reverb: 0.42, echo: 0.12, delay: 0.08 },
  { id: "plate", label: tr("karaoke.plate"), symbol: "◉", reverb: 0.58, echo: 0.08, delay: 0.05 },
  { id: "studio", label: tr("karaoke.studio"), symbol: "◌", reverb: 0.28, echo: 0.06, delay: 0.03 },
  { id: "pop", label: tr("karaoke.pop"), symbol: "☆", reverb: 0.36, echo: 0.24, delay: 0.1 },
  { id: "rock", label: tr("karaoke.rock"), symbol: "ϟ", reverb: 0.3, echo: 0.12, delay: 0.07 },
  { id: "club", label: tr("karaoke.club"), symbol: "◎", reverb: 0.5, echo: 0.38, delay: 0.22 }
];

export const getControls = (isPlaying, onSkip, onTogglePlay, onStop) => [
  [SkipBack, tr("karaoke.back5Seconds"), () => onSkip?.(-5), "outline"],
  [
    isPlaying ? Pause : Play,
    tr(isPlaying ? "audio.pause" : "karaoke.play"),
    onTogglePlay,
    null,
    60
  ],
  [Square, tr("karaoke.stop"), onStop, "outline"],
  [SkipForward, tr("karaoke.forward5Seconds"), () => onSkip?.(5), "outline"]
];

export const getMetrics = (
  currentTempo,
  compactKey,
  noteRangeLabel,
  song,
  shift,
  onTempoChange,
  onKeyShiftChange
) => [
  {
    label: tr("karaoke.pace"),
    value: `${currentTempo} BPM`,
    tone: "var(--color-primary)",
    previousLabel: tr("karaoke.decreaseTempoBy1Bpm"),
    nextLabel: tr("karaoke.increaseTempoBy1Bpm"),
    onPrevious: () => onTempoChange?.(-1),
    onNext: () => onTempoChange?.(1)
  },
  {
    label: tr("karaoke.key"),
    value: compactKey,
    tone: "var(--color-success)",
    previous: ChevronLeft,
    next: ChevronRight,
    previousLabel: tr("karaoke.lowerKey"),
    nextLabel: tr("karaoke.raiseTheKey"),
    onPrevious: () => onKeyShiftChange?.(clamp(shift - 1, -12, 12)),
    onNext: () => onKeyShiftChange?.(clamp(shift + 1, -12, 12))
  },
  {
    label: tr("karaoke.range"),
    value: `${noteRangeLabel(song?.note_range_min, "C2", shift)} – ${noteRangeLabel(
      song?.note_range_max,
      "C5",
      shift
    )}`,
    tone: "var(--color-warning)"
  }
];
