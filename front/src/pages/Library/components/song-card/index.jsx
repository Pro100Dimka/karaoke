import { Button } from "../../../../components/fields";
import { Card, IconButton, StatusBadge } from "../../../../components/ui";
import { getSongCardTilt } from "../../card-tilt";
import { getSongCardState } from "../../utils";
import ProcessingSignal from "../processing-signal";
import SongCardArtwork from "../song-card-artwork";
import { applyCardTilt, formatSongKey, getSongActions } from "./utils";

const INTERACTIVE_SELECTOR = "button, a, input, select, textarea";
const ACTIVATION_KEYS = ["Enter", " "];
const clearCardTilt = ({ currentTarget }) =>
  ["--tilt-x", "--tilt-y", "--glow-x", "--glow-y"].forEach(
    currentTarget.style.removeProperty.bind(currentTarget.style)
  );
const TextItems = ({ items }) =>
  items.map(
    ([v, c], key) =>
      v && (
        <span key={key} className={c}>
          {v}
        </span>
      )
  );

export default function LibrarySongCard({
  cardIndex,
  onOpenKaraoke,
  onOpenProcessing,
  song,
  ...props
}) {
  const {
    artist,
    difficulty_override: difficulty,
    genre,
    key_override: songKey,
    progress_percent: progress,
    status: songStatus,
    tempo_override: tempo,
    title
  } = song;
  const { isWorking, isReady, status } = getSongCardState(song);
  const actions = getSongActions({ ...props, isReady, isWorking, song });
  const titleDetails = [
    [title, "song-title-name"],
    [artist, "song-artist-name"],
    [genre, "song-genre-name"]
  ];
  const metadata = [
    [formatSongKey(songKey)],
    [tempo && `${tempo} BPM`],
    [difficulty]
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
      as="article"
      variant="neon"
      className={`library-song-card library-song-card--${status}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={clearCardTilt}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role={isReady ? "button" : undefined}
      tabIndex={isReady ? 0 : undefined}
      aria-label={isReady ? `Открыть ${title} в караоке` : undefined}
    >
      <SongCardArtwork cardIndex={cardIndex} />
      <div className="library-song-card-main">
        <div className="library-song-card-heading u-row-between">
          <div className="song-title-content">
            <TextItems items={titleDetails} />
          </div>
          <StatusBadge status={songStatus} />
        </div>
        {isWorking && (
          <Button
            unstyled
            type="button"
            className="library-song-card-progress"
            onClick={() => onOpenProcessing(song)}
          >
            <ProcessingSignal progress={progress} compact />
            <span>Открыть обработку</span>
          </Button>
        )}
        <div className="library-song-card-footer">
          <p className="library-song-card-meta u-muted-xs">
            <TextItems items={metadata} />
          </p>
          <div className="library-song-card-actions">
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
                  unstyled
                  icon={Icon}
                  label={label}
                  size={size}
                  onClick={onClick}
                  disabled={disabled}
                  className={`btn btn-${variant} btn-sm library-song-card-icon ${className}`.trim()}
                />
              )
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
