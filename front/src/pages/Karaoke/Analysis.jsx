import { useLocation } from "react-router-dom";
import { Panel } from "../../components/ui";
import { useAnalysis } from "../../hooks/useAnalysis";

function AnalysisTable({ sections }) {
  return (
    <table className="data-table mt-6">
      <thead>
        <tr>
          <th>Фрагмент</th>
          <th>Точность</th>
          <th>Отклонение</th>
        </tr>
      </thead>
      <tbody>
        {sections.map((section, index) => (
          <tr key={index}>
            <td>
              {section.label ||
                `${section.start?.toFixed(1)}–${section.end?.toFixed(1)} с`}
            </td>
            <td>
              {section.accuracy_percent != null
                ? `${section.accuracy_percent}%`
                : "—"}
            </td>
            <td>
              {section.mean_deviation_semitones != null
                ? `±${section.mean_deviation_semitones} п/т`
                : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function EmptyState() {
  return (
    <p className="text-muted">
      Откройте нужное исполнение в разделе «Записанные песни» и нажмите
      «Анализ».
    </p>
  );
}

function LoadingState() {
  return <p className="text-muted">Загружаем результат выступления…</p>;
}

function ErrorState({ error }) {
  return (
    <p className="song-lyrics-error">Не удалось открыть анализ: {error}</p>
  );
}
export default function Analysis() {
  const location = useLocation();
  const recordingId = location.state?.recordingId;
  const { result, error } = useAnalysis(recordingId);

  return (
    <Panel title="Анализ выступления" className="max-w-[900px]">
      {!recordingId && <EmptyState />}
      {recordingId && !result && !error && <LoadingState />}
      {error && <ErrorState error={error} />}
      {result && (
        <>
          <div className="analysis-page-score">
            {result.pitch_accuracy_percent ?? "—"}
            <small>%</small>
          </div>
          <div className="text-muted">
            Попадание в ноты · отклонение{" "}
            {result.mean_deviation_semitones != null
              ? `±${result.mean_deviation_semitones} п/т`
              : "—"}
          </div>
          <AnalysisTable sections={result.sections || []} />
        </>
      )}
    </Panel>
  );
}
