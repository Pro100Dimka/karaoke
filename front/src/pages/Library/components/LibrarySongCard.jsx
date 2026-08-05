import {
  FolderOpen,
  Headphones,
  Play,
  RotateCcw,
  Settings2,
  Trash2
} from "lucide-react";
import { Card, StatusBadge } from "../../../components/ui";
import { getSongCardTilt } from "../card-tilt";
import { getSongCardState } from "../utils";
import SongCardArtwork from "./SongCardArtwork";
import ProcessingSignal from "./ProcessingSignal";

function applyCardTilt(element, tilt) {
  if (!tilt) return;
  element.style.setProperty("--tilt-x", tilt.tiltX);
  element.style.setProperty("--tilt-y", tilt.tiltY);
  element.style.setProperty("--glow-x", tilt.glowX);
  element.style.setProperty("--glow-y", tilt.glowY);
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

  return (
    <Card
      as="article"
      variant="neon"
      className={`library-song-card library-song-card--${status}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
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

        <p className="library-song-card-meta">
          {song.key_override || "Тональность определяется"}
          {song.tempo_override ? ` · ${song.tempo_override} BPM` : ""}
          {song.difficulty_override ? ` · ${song.difficulty_override}` : ""}
        </p>

        {isWorking && (
          <button
            className="library-song-card-progress"
            type="button"
            onClick={() => onOpenProcessing(song)}
          >
            <ProcessingSignal progress={song.progress_percent} compact />
            <span>Открыть обработку</span>
          </button>
        )}

        <div className="library-song-card-footer">
          <div className="library-song-card-actions">
            {isReady ? (
              <>
                <button
                  className="btn btn-primary btn-sm library-song-card-primary"
                  type="button"
                  onClick={() => onOpenKaraoke(song)}
                >
                  <Play size={16} fill="currentColor" />
                </button>
                <button
                  className="btn btn-ghost btn-sm library-song-card-icon"
                  type="button"
                  title="Прослушать записи"
                  aria-label="Прослушать записи"
                  onClick={() => onOpenRecordings(song)}
                >
                  <Headphones size={16} />
                </button>
              </>
            ) : canManageLibrary ? (
              <button
                className="btn btn-primary btn-sm library-song-card-primary"
                disabled={isWorking}
                type="button"
                onClick={() => onProcess(song)}
              >
                <Play size={15} fill="currentColor" /> Обработать
              </button>
            ) : null}

            {canManageLibrary && (
              <button
                className="btn btn-ghost btn-sm library-song-card-icon"
                title="Настройки песни"
                aria-label="Настройки песни"
                type="button"
                onClick={() => onOpenSettings(song.id)}
              >
                <Settings2 size={14} />
              </button>
            )}
            {canManageLibrary && (
              <button
                className="btn btn-ghost btn-sm library-song-card-icon"
                type="button"
                title="Открыть папку"
                aria-label="Открыть папку"
                onClick={() => onOpenFolder(song)}
              >
                <FolderOpen size={14} />
              </button>
            )}
            {canManageLibrary && isReady && (
              <button
                className="btn btn-ghost btn-sm library-song-card-icon"
                type="button"
                title="Переобработать MIDI"
                aria-label="Переобработать MIDI"
                onClick={() => onReprocess(song)}
              >
                <RotateCcw size={14} />
              </button>
            )}
            {canManageLibrary && (
              <button
                className="btn btn-danger btn-sm library-song-card-icon"
                type="button"
                title="Удалить"
                aria-label="Удалить песню"
                onClick={() => onDelete(song)}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
