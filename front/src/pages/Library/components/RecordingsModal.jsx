import { BarChart3, Music2, Trash2 } from "lucide-react";
import { api } from "../../../api/client";
import { AudioPlayer } from "../../../components/AudioPlayer";
import Modal from "../../../components/Modal";
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
      backdropClassName="song-recordings-backdrop"
      modalClassName="song-recordings-modal"
      closeClassName="song-recordings-close"
      closeIconSize={18}
      portal
    >
      {song && (
        <>
          <LibraryModalHeader
            icon={Music2}
            eyebrow="ИСПОЛНЕНИЯ ПЕСНИ"
            title={song.title}
          />
          {error && (
            <p className="song-lyrics-error">
              Не удалось загрузить записи: {getErrorMessage(error)}
            </p>
          )}
          <div className="song-recordings-list library-stack">
            {recordings.map((recording) => (
              <article key={recording.id} className="song-recording-item library-row-between library-glass">
                <div>
                  <strong>{formatLibraryDate(recording.created_at)}</strong>
                  <span>
                    {formatRecordingDuration(recording.duration_sec)} · голос и
                    минус
                  </span>
                </div>
                <AudioPlayer src={api.getPerformanceFileUrl(recording.id)} />
                <div className="song-recording-item-actions library-row">
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => onAnalyze(recording)}
                  >
                    <BarChart3 size={15} /> Анализ
                  </button>
                  <button
                    className="btn btn-danger"
                    title="Удалить запись"
                    aria-label="Удалить запись"
                    onClick={() => onDelete(recording)}
                    type="button"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
          {!recordings.length && !error && (
            <div className="song-recordings-empty">
              Для этой песни пока нет записанных исполнений.
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
