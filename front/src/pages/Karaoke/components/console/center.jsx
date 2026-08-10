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
  tempo: {
    color: "var(--color-primary)",
    border: "var(--color-primary)",
    glow: "color-mix(in srgb, var(--color-primary) 38%, transparent)"
  },

  key: {
    color: "var(--color-success)",
    border: "var(--color-success)",
    glow: "color-mix(in srgb, var(--color-success) 34%, transparent)"
  },

  range: {
    color: "var(--color-warning)",
    border: "var(--color-warning)",
    glow: "color-mix(in srgb, var(--color-warning) 30%, transparent)"
  }
};

function StepButton({ icon: Icon, label, onClick, accent }) {
  return (
    <IconButton
      icon={Icon}
      label={label}
      variant="ghost"
      size="small"
      onClick={onClick}
      sx={{
        inlineSize: 34,
        blockSize: 34,
        flex: "0 0 auto",

        border: "1px solid color-mix(in srgb, currentColor 60%, transparent)",

        borderRadius: "var(--shape-md)",

        color: accent,

        background: "color-mix(in srgb, var(--color-bg-deep) 80%, transparent)",

        transition:
          "transform 140ms ease, background 140ms ease, box-shadow 140ms ease",

        "&:hover": {
          transform: "translateY(-1px)",
          background:
            "color-mix(in srgb, currentColor 12%, var(--color-bg-deep))",
          boxShadow:
            "0 0 0.8rem color-mix(in srgb, currentColor 30%, transparent)"
        }
      }}
    />
  );
}

function PerformanceControl({
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
        minWidth: 0,
        flex: 1,
        borderRadius: "var(--shape-lg)",

        border:
          "1px solid color-mix(in srgb, var(--control-accent) 72%, var(--color-border))",

        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--control-accent) 7%, var(--color-bg-deep)), var(--color-bg-deep))",

        boxShadow:
          "0 0 1rem color-mix(in srgb, var(--control-accent) 12%, transparent)"
      }}
      style={{
        "--control-accent": accent.color
      }}
      cardContent={{
        style: {
          padding: "0.6rem 0.7rem"
        }
      }}
    >
      <Stack gap={1} align="center">
        <Typography
          variant="caption"
          sx={{
            color: accent.color,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.04em"
          }}
        >
          {label}
        </Typography>

        <Stack
          direction="row"
          align="center"
          justify="center"
          gap={1}
          sx={{
            width: "100%"
          }}
        >
          {onDecrease && (
            <StepButton
              icon={leftIcon ?? Minus}
              label={decreaseLabel}
              onClick={onDecrease}
              accent={accent.color}
            />
          )}

          <Typography
            variant="body2"
            sx={{
              minWidth: 74,
              textAlign: "center",
              fontWeight: 800,
              color: "var(--color-text)"
            }}
          >
            {value}
          </Typography>

          {onIncrease && (
            <StepButton
              icon={rightIcon ?? Plus}
              label={increaseLabel}
              onClick={onIncrease}
              accent={accent.color}
            />
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
      gap={1.5}
      align="stretch"
      sx={{
        width: "100%"
      }}
    >
      <PerformanceControl
        label="Темп"
        value={`${currentTempo} BPM`}
        accent={CONTROL_ACCENTS.tempo}
        onDecrease={() => onTempoChange(-1)}
        onIncrease={() => onTempoChange(1)}
        decreaseLabel="Уменьшить темп на 1 BPM"
        increaseLabel="Увеличить темп на 1 BPM"
      />

      <PerformanceControl
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

      <Card
        surface="base"
        tilt={false}
        sx={{
          flex: 1,
          minWidth: 0,

          border:
            "1px solid color-mix(in srgb, var(--color-warning) 72%, var(--color-border))",

          borderRadius: "var(--shape-lg)",

          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--color-warning) 7%, var(--color-bg-deep)), var(--color-bg-deep))",

          boxShadow:
            "0 0 1rem color-mix(in srgb, var(--color-warning) 12%, transparent)"
        }}
        cardContent={{
          style: {
            padding: "0.6rem 0.7rem"
          }
        }}
      >
        <Stack
          align="center"
          justify="center"
          gap={1}
          sx={{
            height: "100%"
          }}
        >
          <Typography
            variant="caption"
            sx={{
              color: "var(--color-warning)",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.04em"
            }}
          >
            Диапазон
          </Typography>

          <Typography
            variant="body2"
            sx={{
              fontWeight: 800,
              color: "var(--color-text)"
            }}
          >
            {noteRange}
          </Typography>
        </Stack>
      </Card>
    </Stack>
  );
}

function TransportButtons({ isPlaying, onSkip, onTogglePlay, onStop }) {
  return (
    <Stack
      direction="row"
      align="center"
      justify="center"
      gap={1.25}
      aria-label="Управление воспроизведением"
    >
      <IconButton
        icon={SkipBack}
        label="Назад на 5 секунд"
        variant="ghost"
        size="large"
        onClick={() => onSkip(-5)}
        sx={{
          inlineSize: 44,
          blockSize: 44,
          borderRadius: "50%",
          border:
            "1px solid color-mix(in srgb, var(--color-primary) 50%, var(--color-border))"
        }}
      />

      <Button
        variant="primary"
        aria-label={isPlaying ? "Пауза" : "Воспроизвести"}
        onClick={onTogglePlay}
        sx={{
          inlineSize: 62,
          blockSize: 62,
          minInlineSize: 62,

          padding: 0,

          borderRadius: "50%",

          display: "grid",
          placeItems: "center",

          background:
            "linear-gradient(145deg, var(--color-primary-hover), var(--color-primary-strong))",

          border:
            "1px solid color-mix(in srgb, var(--color-highlight) 62%, var(--color-primary))",

          boxShadow:
            "0 0 1rem color-mix(in srgb, var(--color-primary) 55%, transparent), 0 0 2.4rem color-mix(in srgb, var(--color-primary-strong) 28%, transparent), inset 0 1px 0 color-mix(in srgb, var(--color-highlight) 55%, transparent)",

          transition:
            "transform 150ms ease, box-shadow 150ms ease, filter 150ms ease",

          "&:hover": {
            transform: "scale(1.06)",
            filter: "brightness(1.08)",
            boxShadow:
              "0 0 1.3rem color-mix(in srgb, var(--color-primary) 72%, transparent), 0 0 3rem color-mix(in srgb, var(--color-primary-strong) 40%, transparent), inset 0 1px 0 color-mix(in srgb, var(--color-highlight) 65%, transparent)"
          },

          "&:active": {
            transform: "scale(0.97)"
          }
        }}
      >
        {isPlaying ? (
          <Pause size={30} />
        ) : (
          <Play
            size={30}
            style={{
              marginLeft: 3
            }}
          />
        )}
      </Button>

      <IconButton
        icon={Square}
        label="Остановить"
        variant="ghost"
        size="large"
        onClick={onStop}
        sx={{
          inlineSize: 44,
          blockSize: 44,
          borderRadius: "50%",
          border:
            "1px solid color-mix(in srgb, var(--color-primary) 50%, var(--color-border))"
        }}
      />

      <IconButton
        icon={SkipForward}
        label="Вперёд на 5 секунд"
        variant="ghost"
        size="large"
        onClick={() => onSkip(5)}
        sx={{
          inlineSize: 44,
          blockSize: 44,
          borderRadius: "50%",
          border:
            "1px solid color-mix(in srgb, var(--color-primary) 50%, var(--color-border))"
        }}
      />
    </Stack>
  );
}

export default function ConsoleCenter(props) {
  return (
    <Stack
      gap={2}
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
