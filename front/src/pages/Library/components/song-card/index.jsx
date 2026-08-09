import { Button } from "../../../../components/fields";
import { IconButton, StatusBadge } from "../../../../components/ui";
import { Card, Stack, Typography } from "../../../../theme/ui";
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
      variant="animation"
      cardContent={{ style: { display: "flex", flexDirection: "row" } }}
    >
      <SongCardArtwork cardIndex={cardIndex} />
      <Stack sx={{ flex: "1 1 0" }}>
        <Stack direction="row" justify="space-between" align="flex-start">
          <div className="song-title-content">
            <TextItems items={titleDetails} />
          </div>
          <StatusBadge status={songStatus} />
        </Stack>
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
        <Stack direction="row" justify="space-between">
          <div style={{ width: "100%" }}>
            <Typography>
              <TextItems items={metadata} />
            </Typography>
          </div>
          <Stack direction="row" gap="0.5rem">
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
          </Stack>
        </Stack>
      </Stack>
    </Card>
  );
}
