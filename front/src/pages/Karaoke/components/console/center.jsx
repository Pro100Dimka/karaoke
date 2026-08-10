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

import {
  Button,
  Card,
  IconButton,
  Stack,
  Typography
} from "../../../../theme/ui";

import { clamp } from "./utils";

const CONTROL_ACCENTS = {
  tempo: "var(--color-primary)",
  key: "var(--color-success)",
  range: "var(--color-warning)"
};

const TRANSPORT_BUTTON_SX = {
  inlineSize: 42,
  blockSize: 42,
  minInlineSize: 42,
  padding: 0,

  borderRadius: "50%",

  color: "var(--color-text-soft)",

  border:
    "1px solid color-mix(in srgb, var(--color-primary) 44%, var(--color-border))",

  background: "color-mix(in srgb, var(--color-bg-deep) 88%, transparent)",

  boxShadow:
    "inset 0 1px 0 color-mix(in srgb, var(--color-highlight) 6%, transparent)",

  transition:
    "transform 140ms ease, color 140ms ease, border-color 140ms ease, background 140ms ease, box-shadow 140ms ease"
};

function StepButton({ icon: Icon, label, onClick, accent }) {
  return (
    <IconButton
      icon={Icon}
      aria-label={label}
      title={label}
      variant="ghost"
      size="sm"
      onClick={onClick}
      sx={{
        inlineSize: 32,
        blockSize: 32,
        minInlineSize: 32,

        padding: 0,

        flex: "0 0 auto",

        borderRadius: "var(--shape-md)",

        color: accent,

        border: "1px solid color-mix(in srgb, currentColor 58%, transparent)",

        background: "color-mix(in srgb, var(--color-bg-deep) 90%, transparent)",

        boxShadow:
          "inset 0 1px 0 color-mix(in srgb, var(--color-highlight) 5%, transparent)",

        transition:
          "transform 140ms ease, background 140ms ease, box-shadow 140ms ease, border-color 140ms ease"
      }}
    />
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
    <Card
      surface="base"
      tilt={false}
      sx={{
        padding: "0.5rem 0.6rem",
        flex: 1,
        borderRadius: "var(--shape-lg)",
        border:
          "1px solid color-mix(in srgb, var(--control-accent) 62%, var(--color-border))",
        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--control-accent) 4%, var(--color-bg-deep)), var(--color-bg-deep))",
        boxShadow:
          "0 0 0.85rem color-mix(in srgb, var(--control-accent) 9%, transparent)"
      }}
      style={{ "--control-accent": accent }}
      cardContent={{ style: { padding: "0.55rem 0.6rem" } }}
    >
      <Stack
        gap={0.75}
        align="center"
        justify="center"
        sx={{
          justifyContent: "space-between",
          height: "100%"
        }}
      >
        <Typography
          variant="caption"
          sx={{
            color: accent,
            fontSize: 11,
            fontWeight: 850,
            lineHeight: 1,
            textTransform: "uppercase",
            letterSpacing: "0.055em"
          }}
        >
          {label}
        </Typography>
        <Stack
          direction="row"
          align="center"
          justify="space-between"
          gap={0.75}
          sx={{
            width: "100%"
          }}
        >
          {onDecrease ? (
            <StepButton
              icon={leftIcon ?? Minus}
              label={decreaseLabel}
              onClick={onDecrease}
              accent={accent}
            />
          ) : (
            <span style={{ width: 32 }} />
          )}

          <Typography
            variant="body2"
            sx={{
              minWidth: 68,
              color: "var(--color-text)",
              fontSize: 13,
              fontWeight: 850,
              lineHeight: 1,
              textAlign: "center",
              whiteSpace: "nowrap"
            }}
          >
            {value}
          </Typography>

          {onIncrease ? (
            <StepButton
              icon={rightIcon ?? Plus}
              label={increaseLabel}
              onClick={onIncrease}
              accent={accent}
            />
          ) : (
            <span style={{ width: 32 }} />
          )}
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
  const noteRange = `${song.note_range_min || "C2"} – ${
    song.note_range_max || "C5"
  }`;

  return (
    <Stack
      direction="row"
      gap={1}
      align="stretch"
      sx={{
        width: "100%"
      }}
    >
      <PerformanceCard
        label="Темп"
        value={`${currentTempo} BPM`}
        accent={CONTROL_ACCENTS.tempo}
        onDecrease={() => onTempoChange(-1)}
        onIncrease={() => onTempoChange(1)}
        decreaseLabel="Уменьшить темп на 1 BPM"
        increaseLabel="Увеличить темп на 1 BPM"
      />
      <PerformanceCard
        label="Тональность"
        value={compactKey}
        accent={CONTROL_ACCENTS.key}
        leftIcon={ChevronLeft}
        rightIcon={ChevronRight}
        onDecrease={() => onKeyShiftChange(clamp(keyShift - 1, -12, 12))}
        onIncrease={() => onKeyShiftChange(clamp(keyShift + 1, -12, 12))}
        decreaseLabel="Понизить тональность"
        increaseLabel="Повысить тональность"
      />
      <PerformanceCard
        label="Диапазон"
        value={noteRange}
        accent={CONTROL_ACCENTS.range}
      />
    </Stack>
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

function PlayButton({ isPlaying, onClick }) {
  return (
    <Button
      variant="primary"
      aria-label={isPlaying ? "Пауза" : "Воспроизвести"}
      title={isPlaying ? "Пауза" : "Воспроизвести"}
      onClick={onClick}
      sx={{
        inlineSize: 58,
        blockSize: 58,
        minInlineSize: 58,

        padding: 0,

        display: "grid",
        placeItems: "center",

        borderRadius: "50%",

        color: "var(--color-text)",

        background:
          "linear-gradient(145deg, var(--color-primary-hover), var(--color-primary-strong))",

        border:
          "1px solid color-mix(in srgb, var(--color-highlight) 54%, var(--color-primary))",

        boxShadow:
          "0 0 0.85rem color-mix(in srgb, var(--color-primary) 52%, transparent), 0 0 1.9rem color-mix(in srgb, var(--color-primary-strong) 22%, transparent), inset 0 1px 0 color-mix(in srgb, var(--color-highlight) 48%, transparent)",

        transition:
          "transform 150ms ease, filter 150ms ease, box-shadow 150ms ease"
      }}
    >
      {isPlaying ? (
        <Pause size={26} strokeWidth={2.1} />
      ) : (
        <Play
          size={27}
          strokeWidth={2.1}
          style={{
            marginInlineStart: 2
          }}
        />
      )}
    </Button>
  );
}

function TransportButtons({ isPlaying, onSkip, onTogglePlay, onStop }) {
  return (
    <Stack
      direction="row"
      align="center"
      justify="center"
      gap={1}
      aria-label="Управление воспроизведением"
    >
      <TransportButton
        icon={SkipBack}
        label="Назад на 5 секунд"
        onClick={() => onSkip(-5)}
      />

      <PlayButton isPlaying={isPlaying} onClick={onTogglePlay} />

      <TransportButton icon={Square} label="Остановить" onClick={onStop} />

      <TransportButton
        icon={SkipForward}
        label="Вперёд на 5 секунд"
        onClick={() => onSkip(5)}
      />
    </Stack>
  );
}

export default function ConsoleCenter(props) {
  return (
    <Stack
      gap={2.25}
      align="center"
      sx={{
        width: "100%"
      }}
    >
      <TransportButtons {...props} />
      <PerformanceControls {...props} />
    </Stack>
  );
}
