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
import { Button, Card, IconButton, Stack, Typography } from "../../../../theme/ui";
import { clamp } from "./utils";

const CONTROL_ACCENTS = {
  tempo: "var(--color-primary)",
  key: "var(--color-success)",
  range: "var(--color-warning)"
};

const TRANSPORT_BUTTON_SX = {
  borderRadius: "50%",
  color: "var(--color-text-soft)",
  border: "1px solid color-mix(in srgb, var(--color-primary) 44%, var(--color-border))",
  background: "color-mix(in srgb, var(--color-bg-deep) 88%, transparent)",
  boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--color-highlight) 6%, transparent)",
  transition:
    "transform 140ms ease, color 140ms ease, border-color 140ms ease, background 140ms ease, box-shadow 140ms ease"
};

const STEP_BUTTON_SX = {
  inlineSize: 32,
  blockSize: 32,
  minInlineSize: 32,
  padding: 0,
  flex: "0 0 auto",
  borderRadius: "var(--shape-md)",
  border: "1px solid color-mix(in srgb, currentColor 58%, transparent)",
  background: "color-mix(in srgb, var(--color-bg-deep) 90%, transparent)",
  boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--color-highlight) 5%, transparent)",
  transition:
    "transform 140ms ease, background 140ms ease, box-shadow 140ms ease, border-color 140ms ease"
};

const CARD_SX = {
  padding: "0.45rem 0.55rem",
  minHeight: 72,
  flex: "1 1 0",
  borderRadius: "var(--shape-lg)",
  border: "1px solid color-mix(in srgb, var(--control-accent) 62%, var(--color-border))",
  background:
    "linear-gradient(180deg, color-mix(in srgb, var(--control-accent) 4%, var(--color-bg-deep)), var(--color-bg-deep))",
  boxShadow: "0 0 0.85rem color-mix(in srgb, var(--control-accent) 9%, transparent)"
};

const LABEL_SX = {
  fontSize: 11,
  fontWeight: 850,
  lineHeight: 1,
  textTransform: "uppercase",
  letterSpacing: "0.055em"
};

const VALUE_SX = {
  minWidth: 68,
  color: "var(--color-text)",
  fontSize: 13,
  fontWeight: 850,
  lineHeight: 1,
  textAlign: "center",
  whiteSpace: "nowrap"
};

const PLAY_BUTTON_SX = {
  inlineSize: 58,
  blockSize: 58,
  minInlineSize: 58,
  padding: 0,
  display: "grid",
  placeItems: "center",
  borderRadius: "50%",
  color: "var(--color-text)",
  background: "linear-gradient(145deg, var(--color-primary-hover), var(--color-primary-strong))",
  border: "1px solid color-mix(in srgb, var(--color-highlight) 54%, var(--color-primary))",
  boxShadow:
    "0 0 0.85rem color-mix(in srgb, var(--color-primary) 52%, transparent), 0 0 1.9rem color-mix(in srgb, var(--color-primary-strong) 22%, transparent), inset 0 1px 0 color-mix(in srgb, var(--color-highlight) 48%, transparent)",
  transition: "transform 150ms ease, filter 150ms ease, box-shadow 150ms ease"
};

function StepButton({ icon = Minus, label, onClick, accent }) {
  return onClick ? (
    <IconButton
      icon={icon}
      aria-label={label}
      title={label}
      variant="ghost"
      size="sm"
      onClick={onClick}
      sx={{ ...STEP_BUTTON_SX, color: accent }}
    />
  ) : (
    <span style={{ width: 32 }} />
  );
}

function PerformanceCard({
  label,
  value,
  accent,
  leftIcon,
  rightIcon,
  onDecrease,
  onIncrease,
  decreaseLabel,
  increaseLabel
}) {
  return (
    <Card surface="base" tilt={false} sx={CARD_SX} style={{ "--control-accent": accent }}>
      <Stack gap={0.75} align="center" justify="space-between" sx={{ height: "100%" }}>
        <Typography variant="caption" sx={{ ...LABEL_SX, color: accent }}>
          {label}
        </Typography>

        <Stack
          direction="row"
          align="center"
          justify="space-between"
          gap={0.75}
          sx={{ width: "100%" }}
        >
          <StepButton icon={leftIcon} label={decreaseLabel} onClick={onDecrease} accent={accent} />

          <Typography variant="body2" sx={VALUE_SX}>
            {value}
          </Typography>

          <StepButton
            icon={rightIcon ?? Plus}
            label={increaseLabel}
            onClick={onIncrease}
            accent={accent}
          />
        </Stack>
      </Stack>
    </Card>
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
    {
      key: "tempo",
      label: "Темп",
      value: `${currentTempo} BPM`,
      onDecrease: () => onTempoChange(-1),
      onIncrease: () => onTempoChange(1),
      decreaseLabel: "Уменьшить темп на 1 BPM",
      increaseLabel: "Увеличить темп на 1 BPM"
    },
    {
      key: "key",
      label: "Тональность",
      value: compactKey,
      leftIcon: ChevronLeft,
      rightIcon: ChevronRight,
      onDecrease: () => onKeyShiftChange(clamp(keyShift - 1, -12, 12)),
      onIncrease: () => onKeyShiftChange(clamp(keyShift + 1, -12, 12)),
      decreaseLabel: "Понизить тональность",
      increaseLabel: "Повысить тональность"
    },
    {
      key: "range",
      label: "Диапазон",
      value: `${song.note_range_min || "C2"} – ${song.note_range_max || "C5"}`
    }
  ];

  return (
    <Stack direction="row" gap={1} align="stretch" sx={{ width: "100%" }}>
      {controls.map(({ key, label, decreaseLabel, increaseLabel, ...props }) => (
        <PerformanceCard
          key={key}
          {...props}
          label={t(label)}
          accent={CONTROL_ACCENTS[key]}
          decreaseLabel={decreaseLabel && t(decreaseLabel)}
          increaseLabel={increaseLabel && t(increaseLabel)}
        />
      ))}
    </Stack>
  );
}

function PlayButton({ isPlaying, onClick }) {
  const label = t(isPlaying ? "Пауза" : "Воспроизвести");
  const Icon = isPlaying ? Pause : Play;

  return (
    <Button
      variant="primary"
      aria-label={label}
      title={label}
      onClick={onClick}
      sx={PLAY_BUTTON_SX}
    >
      <Icon
        size={isPlaying ? 26 : 27}
        strokeWidth={2.1}
        style={isPlaying ? undefined : { marginInlineStart: 2 }}
      />
    </Button>
  );
}

function TransportButton({ icon, label, onClick }) {
  return (
    <IconButton
      icon={icon}
      aria-label={label}
      title={label}
      variant="ghost"
      size="lg"
      onClick={onClick}
      sx={TRANSPORT_BUTTON_SX}
    />
  );
}

function TransportButtons({ isPlaying, onSkip, onTogglePlay, onStop }) {
  const buttons = [
    [SkipBack, "Назад на 5 секунд", () => onSkip(-5)],
    [Square, "Остановить", onStop],
    [SkipForward, "Вперёд на 5 секунд", () => onSkip(5)]
  ];

  return (
    <Stack
      direction="row"
      align="center"
      justify="center"
      gap={0.75}
      aria-label={t("Управление воспроизведением")}
    >
      <TransportButton icon={buttons[0][0]} label={t(buttons[0][1])} onClick={buttons[0][2]} />

      <PlayButton isPlaying={isPlaying} onClick={onTogglePlay} />

      {buttons.slice(1).map(([icon, label, onClick]) => (
        <TransportButton key={label} icon={icon} label={t(label)} onClick={onClick} />
      ))}
    </Stack>
  );
}

export default function ConsoleCenter(props) {
  return (
    <Stack gap={1.15} align="center" justify="flex-end">
      <TransportButtons {...props} />
      <PerformanceControls {...props} />
    </Stack>
  );
}
