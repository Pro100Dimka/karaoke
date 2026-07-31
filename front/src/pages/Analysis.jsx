import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client";
import { Panel } from "../components/ui";

export default function Analysis() {
  const location = useLocation();
  const recordingId = location.state?.recordingId;
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!recordingId) return;
    let active = true;
    api.runAnalysis(recordingId).then((analysis) => {
      if (active) setResult(analysis);
    }).catch((requestError) => {
      if (active) setError(requestError.message);
    });
    return () => { active = false; };
  }, [recordingId]);

  return <Panel title="Анализ выступления" style={{ maxWidth: 900 }}>
    {!recordingId && <p className="text-muted">Откройте нужное исполнение в разделе «Записанные песни» и нажмите «Анализ».</p>}
    {recordingId && !result && !error && <p className="text-muted">Загружаем результат выступления…</p>}
    {error && <p className="song-lyrics-error">Не удалось открыть анализ: {error}</p>}
    {result && <>
      <div className="analysis-page-score">{result.pitch_accuracy_percent ?? "—"}<small>%</small></div>
      <div className="text-muted">Попадание в ноты · отклонение {result.mean_deviation_semitones != null ? `±${result.mean_deviation_semitones} п/т` : "—"}</div>
      <table className="data-table" style={{ marginTop: 22 }}>
        <thead><tr><th>Фрагмент</th><th>Точность</th><th>Отклонение</th></tr></thead>
        <tbody>
          {(result.sections || []).map((section, index) => <tr key={index}>
            <td>{section.label || `${section.start?.toFixed(1)}–${section.end?.toFixed(1)} с`}</td>
            <td>{section.accuracy_percent != null ? `${section.accuracy_percent}%` : "—"}</td>
            <td>{section.mean_deviation_semitones != null ? `±${section.mean_deviation_semitones} п/т` : "—"}</td>
          </tr>)}
        </tbody>
      </table>
    </>}
  </Panel>;
}
