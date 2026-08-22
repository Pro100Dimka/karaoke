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
import { Card, Grid, IconButton, Stack, Typography } from "../../../../theme/ui";
import { clamp } from "./utils";

function Step({ icon, label, onClick }) {
  return onClick ? (
    <IconButton
      icon={icon}
      label={label}
      title={label}
      size="sm"
      variant="ghost"
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
    <Card
      tilt={false}
      cardContent={{ style: { padding: "var(--space-2)" } }}
      style={{ "--card-border": tone }}
    >
      <Stack align="center" gap="var(--space-1)">
        <Typography variant="caption" style={{ color: tone }}>
          {label}
        </Typography>
        <Stack direction="row" align="center" justify="space-between">
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
          label={t("Назад на 5 секунд")}
          variant="outline"
          onClick={() => onSkip(-5)}
        />
        <IconButton
          icon={isPlaying ? Pause : Play}
          label={t(isPlaying ? "Пауза" : "Воспроизвести")}
          size="lg"
          onClick={onTogglePlay}
        />
        <IconButton icon={Square} label={t("Остановить")} variant="outline" onClick={onStop} />
        <IconButton
          icon={SkipForward}
          label={t("Вперёд на 5 секунд")}
          variant="outline"
          onClick={() => onSkip(5)}
        />
      </Stack>
      <Grid columns={3} gap="var(--space-2)">
        <Metric
          label={t("Темп")}
          value={`${currentTempo} BPM`}
          tone="var(--color-primary)"
          previousLabel={t("Уменьшить темп на 1 BPM")}
          nextLabel={t("Увеличить темп на 1 BPM")}
          onPrevious={() => onTempoChange(-1)}
          onNext={() => onTempoChange(1)}
        />
        <Metric
          label={t("Тональность")}
          value={compactKey}
          tone="var(--color-success)"
          previous={ChevronLeft}
          next={ChevronRight}
          previousLabel={t("Понизить тональность")}
          nextLabel={t("Повысить тональность")}
          onPrevious={() => onKeyShiftChange(clamp(keyShift - 1, -12, 12))}
          onNext={() => onKeyShiftChange(clamp(keyShift + 1, -12, 12))}
        />
        <Metric
          label={t("Диапазон")}
          value={`${song.note_range_min || "C2"} – ${song.note_range_max || "C5"}`}
          tone="var(--color-warning)"
        />
      </Grid>
    </Stack>
  );
}
