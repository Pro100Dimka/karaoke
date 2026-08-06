import { BarChart3, Music2, Trash2 } from "lucide-react";
import { api } from "../../../api/client";
import { AudioPlayer } from "../../../components/AudioPlayer";
import { Card, IconButton } from "../../../components/ui";
import { getErrorMessage } from "../../../utils/errors";
import { formatLibraryDate } from "../utils";
import LibraryModal from "./LibraryModal";
import LibraryModalHeader from "./LibraryModalHeader";

export default function RecordingsModal({
  song,
  recordings = [],
  error,
  onAnalyze,
  onClose,
  onDelete
}) {
  return (
    <LibraryModal
      isOpen={Boolean(song)}
      onClose={onClose}
      ariaLabel={song ? `Исполнения песни ${song.title}` : "Исполнения песни"}
      modalClassName="song-recordings-modal"
    >
      {song && (
        <>
          <LibraryModalHeader
            icon={Music2}
            eyebrow="ИСПОЛНЕНИЯ ПЕСНИ"
            title={song.title}
            description="Прослушивайте исполнения, запускайте анализ и управляйте записями."
          />
          <div className="song-recordings-body modal-scroll">
            {error && (
              <p className="field-error">
                Не удалось загрузить записи: {getErrorMessage(error)}
              </p>
            )}
            <div className="song-recordings-list">
              {recordings.map((recording) => (
                <Card
                  key={recording.id}
                  className="song-recording-item"
                  variant="glass"
                >
                  <div className="song-recording-header">
                    <div className="song-recording-meta">
                      <strong>{formatLibraryDate(recording.created_at)}</strong>
                    </div>
                  </div>
                  <AudioPlayer
                    className="song-recording-player"
                    src={api.getPerformanceFileUrl(recording.id)}
                  />
                  <div className="song-recording-item-actions">
                    <IconButton
                      unstyled
                      className="btn btn-ghost btn-sm"
                      icon={BarChart3}
                      size={15}
                      label="Анализировать запись"
                      onClick={() => onAnalyze(recording)}
                    />
                    <IconButton
                      unstyled
                      className="btn btn-danger btn-sm song-recording-delete"
                      icon={Trash2}
                      size={14}
                      label="Удалить запись"
                      onClick={() => onDelete(recording)}
                    />
                  </div>
                </Card>
              ))}
            </div>
            {!recordings.length && !error && (
              <div className="song-recordings-empty">
                Для этой песни пока нет записанных исполнений.
              </div>
            )}
          </div>
        </>
      )}
    </LibraryModal>
  );
}
