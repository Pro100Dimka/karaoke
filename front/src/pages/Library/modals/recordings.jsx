import { BarChart3, Music2, Trash2 } from "lucide-react";
import { api } from "../../../api/client";
import { AudioPlayer } from "../../../components/AudioPlayer";
import Modal from "../../../components/modal";
import { translateSaved } from "../../../i18n/runtime";
import { Card, IconButton, Stack } from "../../../theme/ui";

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
    <Card sx={{ width: "100%" }}>
      <Stack direction="row" gap={1}>
        <Stack sx={{ flex: 3 }}>
          <AudioPlayer
            className="song-recording-player"
            src={api.getPerformanceFileUrl(recording.id)}
            initialDuration={recording.duration_sec}
          />
        </Stack>
        <Stack direction="row" gap={0.5} sx={{ flex: 1 }}>
          {actions.map(([Icon, size, label, className, handler]) => (
            <IconButton
              key={label}
              unstyled
              icon={Icon}
              iconSize={size}
              label={label}
              className={`btn btn-sm ${className}`}
              onClick={() => handler(recording)}
            />
          ))}
        </Stack>
      </Stack>
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
      <Stack gap={1}>
        {recordings.map((recording) => (
          <RecordingCard
            key={recording.id}
            recording={recording}
            onAnalyze={onAnalyze}
            onDelete={onDelete}
          />
        ))}
      </Stack>
      {!recordings.length && !error && (
        <div className="song-recordings-empty u-empty-state">
          {translateSaved("Для этой песни пока нет записанных исполнений.")}
        </div>
      )}
    </Modal>
  );
}
