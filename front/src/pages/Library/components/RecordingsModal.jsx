import { BarChart3, Music2, Trash2 } from "lucide-react";
import { api } from "../../../api/client";
import { AudioPlayer } from "../../../components/AudioPlayer";
import Modal from "../../../components/Modal";
import { Card } from "../../../components/ui";
import { getErrorMessage } from "../../../utils/errors";
import { formatLibraryDate, formatRecordingDuration } from "../utils";
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
    <Modal
      isOpen={Boolean(song)}
      onClose={onClose}
      ariaLabel={song ? `Исполнения песни ${song.title}` : "Исполнения песни"}
      backdropClassName="app-modal-backdrop song-recordings-backdrop"
      modalClassName="app-modal modal-card song-recordings-modal"
      closeClassName="app-modal-close song-recordings-close"
      cardVariant="neon"
      closeIconSize={18}
      portal
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
                <Card key={recording.id} className="song-recording-item" variant="glass">
                  <div className="song-recording-header">
                    <div className="song-recording-meta">
                      <strong>{formatLibraryDate(recording.created_at)}</strong>
                      <span>
                        {formatRecordingDuration(recording.duration_sec)} · голос и минус
                      </span>
                    </div>
                    <div className="song-recording-item-actions">
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        onClick={() => onAnalyze(recording)}
                      >
                        <BarChart3 size={15} /> Анализ
                      </button>
                      <button
                        className="btn btn-danger btn-sm song-recording-delete"
                        title="Удалить запись"
                        aria-label="Удалить запись"
                        onClick={() => onDelete(recording)}
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <AudioPlayer
                    className="song-recording-player"
                    src={api.getPerformanceFileUrl(recording.id)}
                  />
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
    </Modal>
  );
}
