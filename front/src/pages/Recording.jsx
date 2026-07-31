import { Music2, Trash2, BarChart3, Mic2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { Panel } from "../components/ui";

function formatDate(value) {
  return value ? new Date(value).toLocaleString("ru-RU") : "—";
}

export default function Recording() {
  const navigate = useNavigate();
  const { data: recordings, error } = usePolling(api.listRecordingLibrary, 4000, []);

  const deleteRecording = async (id) => {
    if (!window.confirm("Удалить эту записанную песню?")) return;
    await api.deleteRecording(id);
  };

  return (
    <Panel title="Записанные песни" actions={
      <button className="btn btn-primary" onClick={() => navigate("/karaoke")}>
        <Mic2 size={15} /> Открыть караоке
      </button>
    }>
      <p className="text-muted recording-library-intro">
        Здесь хранятся исполнения: голос и готовая версия с минусом. Новая запись начинается в караоке вместе с песней.
      </p>
      {error && <p className="song-lyrics-error">Не удалось загрузить записи: {error.message}</p>}
      <div className="recording-library">
        {(recordings || []).map((recording) => (
          <article className="recording-library-item" key={recording.id}>
            <div className="recording-library-icon"><Music2 size={19} /></div>
            <div className="recording-library-main">
              <strong>{recording.song_title}</strong>
              <span>{formatDate(recording.created_at)} · {recording.duration_sec?.toFixed(1) || "0.0"} с</span>
              <audio controls preload="metadata" src={api.getPerformanceFileUrl(recording.id)} />
            </div>
            <div className="recording-library-actions">
              <button className="btn btn-ghost" title="Анализ исполнения"
                onClick={() => navigate("/analysis", { state: { songId: recording.song_id, recordingId: recording.id } })}>
                <BarChart3 size={15} /> Анализ
              </button>
              <button className="btn btn-danger" title="Удалить запись" onClick={() => deleteRecording(recording.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {(recordings || []).length === 0 && !error && (
        <div className="recording-library-empty">
          Пока нет записанных песен. Откройте обработанную композицию в караоке и нажмите «Воспроизвести».
        </div>
      )}
    </Panel>
  );
}
