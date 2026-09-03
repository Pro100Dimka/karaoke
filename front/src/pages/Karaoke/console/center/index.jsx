import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Square
} from "lucide-react";
import { translateSaved as t } from "../../../../i18n/runtime";
import { Grid, IconButton, Stack } from "../../../../theme/ui";
import { clamp, noteRangeLabel } from "../utils";
import Metric from "./metric";

export default function ConsoleCenter({
  song,
  currentTempo,
  compactKey,
  keyShift,
  onTempoChange,
  onKeyShiftChange,
  isPlaying,
  onSkip,
  onTogglePlay,
  onStop
}) {
  const shift = Number(keyShift) || 0;
  const controls = [
    [SkipBack, t("karaoke.back5Seconds"), () => onSkip?.(-5), "outline"],
    [isPlaying ? Pause : Play, t(isPlaying ? "audio.pause" : "karaoke.play"), onTogglePlay, null, 60],
    [Square, t("karaoke.stop"), onStop, "outline"],
    [SkipForward, t("karaoke.forward5Seconds"), () => onSkip?.(5), "outline"]
  ];
  const metrics = [
    {
      label: t("karaoke.pace"),
      value: `${currentTempo} BPM`,
      tone: "var(--color-primary)",
      previousLabel: t("karaoke.decreaseTempoBy1Bpm"),
      nextLabel: t("karaoke.increaseTempoBy1Bpm"),
      onPrevious: () => onTempoChange?.(-1),
      onNext: () => onTempoChange?.(1)
    },
    {
      label: t("karaoke.key"),
      value: compactKey,
      tone: "var(--color-success)",
      previous: ChevronLeft,
      next: ChevronRight,
      previousLabel: t("karaoke.lowerKey"),
      nextLabel: t("karaoke.raiseTheKey"),
      onPrevious: () => onKeyShiftChange?.(clamp(shift - 1, -12, 12)),
      onNext: () => onKeyShiftChange?.(clamp(shift + 1, -12, 12))
    },
    {
      label: t("karaoke.range"),
      value: `${noteRangeLabel(song?.note_range_min, "C2", shift)} – ${noteRangeLabel(
        song?.note_range_max,
        "C5",
        shift
      )}`,
      tone: "var(--color-warning)"
    }
  ];

  return (
    <Stack align="center" justify="space-between" gap="var(--space-2)">
      <Stack direction="row" align="center" justify="center" gap="var(--space-2)">
        {controls.map(([icon, label, onClick, variant, iconSize]) => (
          <IconButton
            key={label}
            icon={icon}
            label={label}
            variant={variant}
            iconSize={iconSize}
            onClick={onClick}
          />
        ))}
      </Stack>

      <Grid columns={metrics.length} gap="var(--space-2)">
        {metrics.map((metric) => (
          <Metric key={metric.label} {...metric} />
        ))}
      </Grid>
    </Stack>
  );
}
