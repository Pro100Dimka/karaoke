import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Mic, Square, Trash2, Play } from "lucide-react";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { Panel } from "../components/ui";

export default function Recording() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: songs } = usePolling(api.listSongs, 5000, []);
  const [songId] = useState(location.state?.songId || null);
  const song = songId ? (songs || []).find((s) => s.id === songId) : (songs || []).find((s) => s.status === "done");

  const { data: devices } = usePolling(api.listAudioDevices, 10000, []);
  const { data: audioSettings } = usePolling(api.getAudioSettings, 5000, []);

  const [sessionId, setSessionId] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => () => clearInterval(timerRef.current), []);

  const { data: recordings } = usePolling(
    () => (song ? api.listRecordingsForSong(song.id) : Promise.resolve([])),
    4000,
    [song?.id]
  );

  const { data: signal } = usePolling(
    () => (sessionId ? api.getSignalQuality() : Promise.resolve(null)),
    800,
    [sessionId]
  );

  const handleDeviceChange = async (e) => {
    await api.updateAudioSettings({ input_device_id: Number(e.target.value) });
  };

  const startRecording = async () => {
    if (!song) return;
    setError(null);
    try {
      const res = await api.startRecording(song.id);
      setSessionId(res.recording_session_id);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (err) {
      setError(err.message);
    }
  };

  const stopRecording = async () => {
    if (!sessionId) return;
    clearInterval(timerRef.current);
    try {
      const recording = await api.stopRecording(sessionId);
      navigate("/analysis", {
        state: { songId: song.id, recordingId: recording.id, autoRun: true },
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSessionId(null);
    }
  };

  const deleteRecording = async (id) => {
    await api.deleteRecording(id);
  };

  const format = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 18 }}>
      <Panel title="Запись">
        <div style={{ marginBottom: 14 }}>
          <div className="text-secondary" style={{ fontSize: 12, marginBottom: 6 }}>Микрофон</div>
          <select
            className="input"
            style={{ width: "100%" }}
            value={audioSettings?.input_device_id ?? ""}
            onChange={handleDeviceChange}
          >
            <option value="">По умолчанию</option>
            {(devices || []).map((d) => (
              <option key={d.index} value={d.index}>{d.name}</option>
            ))}
          </select>
          {(devices || []).length === 0 && (
            <p className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
              Устройства не найдены — проверьте, что PortAudio установлена (см. Диагностику)
            </p>
          )}
        </div>

        <div style={{ marginBottom: 14 }}>
          <div className="text-secondary" style={{ fontSize: 12, marginBottom: 6 }}>Уровень сигнала</div>
          <div className="progress-track" style={{ height: 10 }}>
            <div
              className="progress-fill"
              style={{ width: `${signal ? Math.min(100, Math.max(0, (signal.rms_db + 60) * 1.6)) : 0}%` }}
            />
          </div>
          <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
            {signal ? `${signal.rms_db} дБ ${signal.clipping ? "· клиппинг!" : ""} ${signal.silent ? "· тихо" : ""}` : "—"}
          </div>
        </div>

        <div style={{ textAlign: "center", margin: "22px 0" }}>
          <div className="mono" style={{ fontSize: 32, fontWeight: 700 }}>{format(elapsed)}</div>
        </div>

        {error && <p style={{ color: "var(--danger)", fontSize: 12 }}>{error}</p>}

        <div style={{ display: "flex", gap: 8 }}>
          {!sessionId ? (
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={startRecording} disabled={!song}>
              <Mic size={15} /> Запись
            </button>
          ) : (
            <button className="btn btn-danger" style={{ flex: 1 }} onClick={stopRecording}>
              <Square size={15} /> Стоп
            </button>
          )}
        </div>
        {!song && <p className="text-muted" style={{ fontSize: 12, marginTop: 10 }}>Выберите готовую песню в Библиотеке</p>}
      </Panel>

      <Panel title={`Записи ${song ? `— ${song.title}` : ""}`}>
        <table className="data-table">
          <thead>
            <tr><th>Файл</th><th>Длительность</th><th></th></tr>
          </thead>
          <tbody>
            {(recordings || []).map((r) => (
              <tr key={r.id}>
                <td>{r.filename}</td>
                <td className="mono text-muted">{r.duration_sec ? `${r.duration_sec.toFixed(1)} с` : "—"}</td>
                <td>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <audio controls src={api.getRecordingFileUrl(r.id)} style={{ height: 28 }} />
                    <button className="btn btn-danger" onClick={() => deleteRecording(r.id)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {(recordings || []).length === 0 && (
              <tr><td colSpan={3} className="text-muted" style={{ textAlign: "center", padding: 20 }}>Записей пока нет</td></tr>
            )}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
