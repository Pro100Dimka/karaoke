import {
  AudioWaveform,
  FolderOpen,
  Headphones,
  RotateCcw,
  Settings2,
  Trash2
} from "lucide-react";
import { Button } from "../../../components/fields";
import { Card, IconButton, StatusBadge } from "../../../components/ui";
import { getSongCardTilt } from "../card-tilt";
import { getSongCardState } from "../utils";
import SongCardArtwork from "./SongCardArtwork";
import ProcessingSignal from "./ProcessingSignal";


function formatSongKey(value) {
  if (!value) return "Тональность определяется";

  return String(value)
    .trim()
    .replace(/\s+minor$/i, "m")
    .replace(/\s+major$/i, "maj");
}

function applyCardTilt(element, tilt) {
  if (!tilt) return;
  element.style.setProperty("--tilt-x", tilt.tiltX);
  element.style.setProperty("--tilt-y", tilt.tiltY);
  element.style.setProperty("--glow-x", tilt.glowX);
  element.style.setProperty("--glow-y", tilt.glowY);
}

function getSongActions({
  canManageLibrary,
  isReady,
  isWorking,
  onDelete,
  onOpenFolder,
  onOpenRecordings,
  onOpenSettings,
  onProcess,
  onReprocess,
  song
}) {
  const primaryAction = isReady
    ? {
        icon: Headphones,
        label: "Прослушать записи",
        onClick: () => onOpenRecordings(song),
        size: 15,
        variant: "ghost"
      }
    : canManageLibrary
      ? {
          className: "library-song-card-process",
          disabled: isWorking,
          icon: AudioWaveform,
          label: "Обработать песню",
          onClick: () => onProcess(song),
          size: 16,
          variant: "primary"
        }
      : null;

  const managementActions = canManageLibrary
    ? [
        {
          icon: Settings2,
          label: "Настройки песни",
          onClick: () => onOpenSettings(song.id),
          size: 14,
          variant: "ghost"
        },
        {
          icon: FolderOpen,
          label: "Открыть папку",
          onClick: () => onOpenFolder(song),
          size: 14,
          variant: "ghost"
        },
        isReady
          ? {
              icon: RotateCcw,
              label: "Переобработать MIDI",
              onClick: () => onReprocess(song),
              size: 14,
              variant: "ghost"
            }
          : null,
        {
          icon: Trash2,
          label: "Удалить песню",
          onClick: () => onDelete(song),
          size: 15,
          variant: "danger"
        }
      ].filter(Boolean)
    : [];

  return [primaryAction, ...managementActions].filter(Boolean);
}

export default function LibrarySongCard({
  canManageLibrary,
  cardIndex,
  onDelete,
  onOpenFolder,
  onOpenKaraoke,
  onOpenProcessing,
  onOpenRecordings,
  onOpenSettings,
  onProcess,
  onReprocess,
  song
}) {
  const { isWorking, isReady, status } = getSongCardState(song);
  const actions = getSongActions({
    canManageLibrary,
    isReady,
    isWorking,
    onDelete,
    onOpenFolder,
    onOpenRecordings,
    onOpenSettings,
    onProcess,
    onReprocess,
    song
  });

  const handlePointerMove = (event) => {
    const element = event.currentTarget;
    const tilt = getSongCardTilt(
      event.clientX,
      event.clientY,
      element.getBoundingClientRect()
    );
    applyCardTilt(element, tilt);
  };

  const handlePointerLeave = (event) => {
    event.currentTarget.style.removeProperty("--tilt-x");
    event.currentTarget.style.removeProperty("--tilt-y");
    event.currentTarget.style.removeProperty("--glow-x");
    event.currentTarget.style.removeProperty("--glow-y");
  };

  const openReadySong = (event) => {
    if (!isReady || event.target.closest("button, a, input, select, textarea")) return;
    onOpenKaraoke(song);
  };

  const handleCardKeyDown = (event) => {
    if (!isReady || (event.key !== "Enter" && event.key !== " ")) return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    onOpenKaraoke(song);
  };

  return (
    <Card
      as="article"
      variant="neon"
      className={`library-song-card library-song-card--${status}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onClick={openReadySong}
      onKeyDown={handleCardKeyDown}
      role={isReady ? "button" : undefined}
      tabIndex={isReady ? 0 : undefined}
      aria-label={isReady ? `Открыть ${song.title} в караоке` : undefined}
    >
      <SongCardArtwork cardIndex={cardIndex} />
      <div className="library-song-card-main">
        <div className="library-song-card-heading u-row-between">
          <div className="song-title-content">
            <span className="song-title-name">{song.title}</span>
            {song.artist && (
              <span className="song-artist-name">{song.artist}</span>
            )}
            {song.genre && (
              <span className="song-genre-name">{song.genre}</span>
            )}
          </div>
          <StatusBadge status={song.status} />
        </div>


        {isWorking && (
          <Button
            unstyled
            className="library-song-card-progress"
            onClick={() => onOpenProcessing(song)}
          >
            <ProcessingSignal progress={song.progress_percent} compact />
            <span>Открыть обработку</span>
          </Button>
        )}

        <div className="library-song-card-footer">
          <p className="library-song-card-meta">
            <span>{formatSongKey(song.key_override)}</span>
            {song.tempo_override ? <span>{song.tempo_override} BPM</span> : null}
            {song.difficulty_override ? (
              <span>{song.difficulty_override}</span>
            ) : null}
          </p>
          <div className="library-song-card-actions">
            {actions.map(({ className = "", icon, label, variant, ...props }) => (
              <IconButton
                key={label}
                unstyled
                className={`btn btn-${variant} btn-sm library-song-card-icon ${className}`.trim()}
                icon={icon}
                label={label}
                {...props}
              />
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
