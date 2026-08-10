import { memo } from "react";
import {
  Badge,
  Button,
  Card,
  IconButton,
  Stack,
  Typography
} from "../../../../theme/ui";
import { getSongCardTilt } from "../../card-tilt";
import { getSongCardState } from "../../utils";
import ProcessingSignal from "./processing-signal";
import SongCardArtwork from "./song-card-artwork";
import { applyCardTilt, formatSongKey, getSongActions } from "./utils";

const INTERACTIVE_SELECTOR = "button, a, input, select, textarea";
const ACTIVATION_KEYS = ["Enter", " "];
const STATUS = {
  pending: ["Ожидание", "badge-pending"],
  queued: ["В очереди", "badge-pending"],
  processing: ["Обрабатывается", "badge-processing"],
  cancelling: ["Отмена...", "badge-processing"],
  cancelled: ["Отменено", "badge-cancelled"],
  done: ["Готово", "badge-done"],
  error: ["Ошибка", "badge-error"]
};
const clearCardTilt = ({ currentTarget }) =>
  ["--tilt-x", "--tilt-y", "--glow-x", "--glow-y"].forEach(
    currentTarget.style.removeProperty.bind(currentTarget.style)
  );
const TextItems = ({ items }) =>
  items.map((value, key) => value && <span key={key}>{value}</span>);
const SongStatusBadge = ({ status }) => {
  const [label, className] = STATUS[status] ?? [
    status || "Неизвестно",
    "badge-pending"
  ];
  return (
    <Badge invisible className={`badge ${className}`}>
      <span className="badge-dot" aria-hidden="true" />
      {label}
    </Badge>
  );
};

function LibrarySongCard({
  cardIndex,
  onOpenKaraoke,
  onOpenProcessing,
  song,
  ...props
}) {
  const {
    artist,
    difficulty_override: difficulty,
    key_override: songKey,
    progress_percent: progress,
    status: songStatus,
    tempo_override: tempo,
    title
  } = song;
  const { isWorking, isReady } = getSongCardState(song);
  const actions = getSongActions({ ...props, isReady, isWorking, song });
  const titleDetails = [title, artist];
  const metadata = [
    formatSongKey(songKey),
    tempo && `${tempo} BPM`,
    difficulty
  ];
  const handlePointerMove = ({ clientX, clientY, currentTarget }) =>
    applyCardTilt(
      currentTarget,
      getSongCardTilt(clientX, clientY, currentTarget.getBoundingClientRect())
    );
  const handleClick = ({ target }) =>
    !target.closest(INTERACTIVE_SELECTOR) && isReady && onOpenKaraoke(song);
  const handleKeyDown = (event) => {
    if (
      event.target !== event.currentTarget ||
      !ACTIVATION_KEYS.includes(event.key) ||
      !isReady
    )
      return;
    event.preventDefault();
    onOpenKaraoke(song);
  };
  return (
    <Card
      variant="neon"
      className={`library-song-card library-song-card--${songStatus}`}
      // onPointerMove={handlePointerMove}
      // onPointerLeave={clearCardTilt}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role={isReady ? "button" : undefined}
      tabIndex={isReady ? 0 : undefined}
      aria-label={isReady ? `Открыть ${title} в караоке` : undefined}
    >
      <SongCardArtwork cardIndex={cardIndex} />
      <Stack className="library-song-card-main" sx={{ flex: "1 1 0" }}>
        <Stack
          className="library-song-card-heading"
          direction="row"
          justify="space-between"
          align="flex-start"
        >
          <div className="song-title-content">
            <TextItems items={titleDetails} />
          </div>
          <SongStatusBadge status={songStatus} />
        </Stack>
        {isWorking && (
          <Button
            type="button"
            variant="ghost"
            style={{ width: "100%" }}
            className="library-song-card-progress"
            onClick={() => onOpenProcessing(song)}
          >
            <ProcessingSignal progress={progress} compact />
          </Button>
        )}
        <Stack
          className="library-song-card-footer"
          direction="row"
          justify="space-between"
        >
          <div style={{ width: "100%" }}>
            <Typography className="library-song-card-meta" sx={{ padding: 0 }}>
              <TextItems items={metadata} />
            </Typography>
          </div>
          <Stack
            className="library-song-card-actions"
            direction="row"
            gap="0.5rem"
          >
            {actions.map(
              ([
                Icon,
                label,
                variant,
                onClick,
                size,
                { className = "", disabled = false } = {}
              ]) => (
                <IconButton
                  key={label}
                  variant={variant === "primary" ? "solid" : "ghost"}
                  tone={variant === "danger" ? "danger" : "primary"}
                  size="sm"
                  aria-label={label}
                  title={label}
                  onClick={onClick}
                  disabled={disabled}
                  className={`btn btn-${variant} btn-sm library-song-card-icon ${className}`.trim()}
                >
                  <Icon size={size} aria-hidden="true" />
                </IconButton>
              )
            )}
          </Stack>
        </Stack>
      </Stack>
    </Card>
  );
}

export default memo(LibrarySongCard);
