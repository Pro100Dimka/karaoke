import { BarChart3, Music2, Trash2 } from "lucide-react";
import { api } from "../../../api/client";
import { AudioPlayer } from "../../../components/AudioPlayer";
import Modal from "../../../components/modal";
import { Card, IconButton } from "../../../components/ui";
import { translateSaved } from "../../../i18n/runtime";
import { getErrorMessage } from "../../../utils/errors";
import { formatLibraryDate } from "../utils";

const TITLE = {
  icon: Music2,
  eyebrow: translateSaved("ИСПОЛНЕНИЯ ПЕСНИ"),
  description: translateSaved("Прослушивайте исполнения, запускайте анализ и управляйте записями.")
};
function RecordingCard({ recording, onAnalyze, onDelete }) {
  const actions = [
    [BarChart3, 15, translateSaved("Анализировать запись"), "btn-ghost", onAnalyze],
    [Trash2, 14, translateSaved("Удалить запись"), "btn-danger song-recording-delete", onDelete]
  ];
  return (
    <Card className="song-recording-item" variant="glass">
      <strong className="song-recording-meta">{formatLibraryDate(recording.created_at)}</strong>
      <AudioPlayer
        className="song-recording-player"
        src={api.getPerformanceFileUrl(recording.id)}
        initialDuration={recording.duration_sec}
      />
      <div className="song-recording-item-actions">
        {actions.map(([Icon, size, label, className, handler]) => (
          <IconButton
            key={label}
            unstyled
            icon={Icon}
            size={size}
            label={label}
            className={`btn btn-sm ${className}`}
            onClick={() => handler(recording)}
          />
        ))}
      </div>
    </Card>
  );
}
export default function RecordingsModal({
  song,
  recordings = [],
  error,
  onAnalyze,
  onClose,
  onDelete
}) {
  if (!song) return null;
  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabel={translateSaved("Исполнения песни {0}", { 0: song.title })}
      titleProps={{ ...TITLE, title: song.title }}
    >
      <div className="song-recordings-body modal-scroll">
        {error && (
          <p className="field-error">
            {translateSaved("Не удалось загрузить записи:")}
            {getErrorMessage(error)}
          </p>
        )}
        <div className="song-recordings-list">
          {recordings.map((recording) => (
            <RecordingCard
              key={recording.id}
              recording={recording}
              onAnalyze={onAnalyze}
              onDelete={onDelete}
            />
          ))}
        </div>
        {!recordings.length && !error && (
          <div className="song-recordings-empty u-empty-state">
            {translateSaved("Для этой песни пока нет записанных исполнений.")}
          </div>
        )}
      </div>
    </Modal>
  );
}
