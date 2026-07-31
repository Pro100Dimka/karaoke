import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { Panel } from "../components/ui";
import { PlayCircle } from "lucide-react";

export default function Analysis() {
  const location = useLocation();
  const { data: songs } = usePolling(api.listSongs, 5000, []);
  const [songId] = useState(location.state?.songId || null);
  const song = songId ? (songs || []).find((s) => s.id === songId) : (songs || []).find((s) => s.status === "done");

  const { data: recordings } = usePolling(
    () => (song ? api.listRecordingsForSong(song.id) : Promise.resolve([])),
    5000,
    [song?.id]
  );

  const [selectedId, setSelectedId] = useState(location.state?.recordingId || null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const autoRunStarted = useRef(false);

  const runAnalysis = async (recordingId) => {
    setSelectedId(recordingId);
    setLoading(true);
    setError(null);
    try {
      const res = await api.runAnalysis(recordingId);
      setResult(res);
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (location.state?.autoRun && location.state?.recordingId && !autoRunStarted.current) {
      autoRunStarted.current = true;
      runAnalysis(location.state.recordingId);
    }
  // The route state represents a one-time action after recording is stopped.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 18 }}>
      <Panel title="Записи">
        {(recordings || []).map((r) => (
          <button
            key={r.id}
            onClick={() => runAnalysis(r.id)}
            className="btn btn-ghost"
            style={{
              width: "100%",
              justifyContent: "space-between",
              marginBottom: 8,
              background: selectedId === r.id ? "rgba(139,92,246,0.15)" : undefined,
            }}
          >
            <span>{r.filename}</span>
            <PlayCircle size={14} />
          </button>
        ))}
        {(recordings || []).length === 0 && (
          <p className="text-muted" style={{ fontSize: 12 }}>Сначала сделайте запись на экране «Запись»</p>
        )}
      </Panel>

      <Panel title="Анализ выступления">
        {loading && <p className="text-muted">Анализируем...</p>}
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        {!loading && !result && !error && <p className="text-muted">Выберите запись слева, чтобы запустить анализ</p>}

        {result && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 24, marginBottom: 24 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 40, fontWeight: 800, color: "var(--success)" }}>
                  {result.pitch_accuracy_percent ?? "—"}%
                </div>
                <div className="text-muted" style={{ fontSize: 12 }}>Общий балл</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, fontSize: 13 }}>
                <Metric label="Попадание в ноты" value={`${result.pitch_accuracy_percent ?? "—"}%`} />
                <Metric label="Отклонение" value={`±${result.mean_deviation_semitones ?? "—"} п/т`} />
              </div>
            </div>

            <div className="text-secondary" style={{ fontSize: 12, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Проблемные места (по секциям)
            </div>
            <table className="data-table">
              <thead>
                <tr><th>Секция</th><th>Точность</th><th>Отклонение</th></tr>
              </thead>
              <tbody>
                {(result.sections || []).map((s, i) => (
                  <tr key={i}>
                    <td>{s.label || `${s.start?.toFixed(1)}–${s.end?.toFixed(1)}с`}</td>
                    <td className={s.accuracy_percent < 70 ? "" : "text-secondary"}
                        style={s.accuracy_percent < 70 ? { color: "var(--danger)" } : undefined}>
                      {s.accuracy_percent != null ? `${s.accuracy_percent}%` : "—"}
                    </td>
                    <td className="text-muted">{s.mean_deviation_semitones != null ? `±${s.mean_deviation_semitones}` : "—"}</td>
                  </tr>
                ))}
                {(!result.sections || result.sections.length === 0) && (
                  <tr><td colSpan={3} className="text-muted" style={{ textAlign: "center", padding: 16 }}>Разбивка по секциям недоступна</td></tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </Panel>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "10px 12px" }}>
      <div className="text-muted" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 16 }}>{value}</div>
    </div>
  );
}
