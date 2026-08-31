import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  Square
} from "lucide-react";
import { translateSaved as t } from "../../../../i18n/runtime";
import { Card, Grid, IconButton, NumberField, Stack, Typography } from "../../../../theme/ui";
import { clamp } from "./utils";

const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export const noteRangeLabel = (value, fallback, shift = 0) => {
  if (value == null || value === "") return fallback;
  const midi = Number(value);
  if (!Number.isFinite(midi)) return String(value || fallback);
  const transposed = clamp(Math.round(midi) + Number(shift || 0), 0, 127);
  return `${NOTE_NAMES[transposed % 12]}${Math.floor(transposed / 12) - 1}`;
};

function Step({ icon, label, onClick }) {
  return onClick ? (
    <IconButton
      icon={icon}
      label={label}
      title={label}
      size="sm"
      variant="outline"
      onClick={onClick}
    />
  ) : null;
}
function Metric({
  label,
  value,
  tone,
  previous,
  next,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext
}) {
  return (
    <Card tilt={false} style={{ "--card-border": tone }}>
      <Stack align="center" gap="var(--space-1)" sx={{ padding: "var(--space-2) 0" }}>
        <Typography variant="caption" style={{ color: tone }}>
          {label}
        </Typography>
        <Stack direction="row" align="center" justify="space-around">
          <Step icon={previous || Minus} label={previousLabel} onClick={onPrevious} />
          <Typography variant="body2">
            <strong>{value}</strong>
          </Typography>
          <Step icon={next || Plus} label={nextLabel} onClick={onNext} />
        </Stack>
      </Stack>
    </Card>
  );
}
export default function ConsoleCenter({
  song,
  currentTempo,
  compactKey,
  keyShift,
  onTempoChange,
  onKeyShiftChange,
  lyricsOffset = 0,
  onLyricsOffsetChange,
  isPlaying,
  onSkip,
  onTogglePlay,
  onStop
}) {
  return (
    <Stack align="center" justify="space-between" gap="var(--space-2)">
      <Stack direction="row" align="center" justify="center" gap="var(--space-2)">
        <IconButton
          icon={SkipBack}
          label={t("karaoke.back5Seconds")}
          variant="outline"
          onClick={() => onSkip(-5)}
        />
        <IconButton
          icon={isPlaying ? Pause : Play}
          label={t(isPlaying ? "audio.pause" : "karaoke.play")}
          iconSize={60}
          onClick={onTogglePlay}
        />
        <IconButton icon={Square} label={t("karaoke.stop")} variant="outline" onClick={onStop} />
        <IconButton
          icon={SkipForward}
          label={t("karaoke.forward5Seconds")}
          variant="outline"
          onClick={() => onSkip(5)}
        />
      </Stack>
      <Grid columns={4} gap="var(--space-2)">
        <Metric
          label={t("karaoke.pace")}
          value={`${currentTempo} BPM`}
          tone="var(--color-primary)"
          previousLabel={t("karaoke.decreaseTempoBy1Bpm")}
          nextLabel={t("karaoke.increaseTempoBy1Bpm")}
          onPrevious={() => onTempoChange(-1)}
          onNext={() => onTempoChange(1)}
        />
        <Metric
          label={t("karaoke.key")}
          value={compactKey}
          tone="var(--color-success)"
          previous={ChevronLeft}
          next={ChevronRight}
          previousLabel={t("karaoke.lowerKey")}
          nextLabel={t("karaoke.raiseTheKey")}
          onPrevious={() => onKeyShiftChange(clamp(keyShift - 1, -12, 12))}
          onNext={() => onKeyShiftChange(clamp(keyShift + 1, -12, 12))}
        />
        <Metric
          label={t("karaoke.range")}
          value={`${noteRangeLabel(song.note_range_min, "C2", keyShift)} – ${noteRangeLabel(
            song.note_range_max,
            "C5",
            keyShift
          )}`}
          tone="var(--color-warning)"
        />
        <Card tilt={false} style={{ "--card-border": "var(--color-info)" }}>
          <Stack align="center" gap="var(--space-1)" sx={{ padding: "var(--space-2)" }}>
            <Typography variant="caption" style={{ color: "var(--color-info)" }}>
              {t("karaoke.lyricsOffset")}
            </Typography>
            <NumberField
              aria-label={t("karaoke.lyricsOffsetInSeconds")}
              min={-10}
              max={10}
              step={0.1}
              size="sm"
              value={Number(lyricsOffset).toFixed(1)}
              onChange={(event) => {
                const value = Number(event?.target?.value ?? event);
                if (Number.isFinite(value)) onLyricsOffsetChange?.(value);
              }}
            />
            <Typography variant="caption" tone="muted">
              {t("karaoke.earlierLater")}
            </Typography>
          </Stack>
        </Card>
      </Grid>
    </Stack>
  );
}
