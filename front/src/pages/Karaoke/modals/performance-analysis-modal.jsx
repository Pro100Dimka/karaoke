import { BarChart3, Trash2, Trophy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../api/client";
import { AudioPlayer } from "../../../components/AudioPlayer";
import { Button } from "../../../components/fields";
import Modal from "../../../components/modal";
import { useAppDialog } from "../../../contexts/AppDialog";
import useExclusiveAsyncAction from "../../../hooks/useExclusiveAsyncAction";
import useMountedRef from "../../../hooks/useMountedRef";
import { getErrorMessage } from "../../../utils/errors";
import {
  getAnalysisFeedback,
  normalizeAnalysisResult
} from "../utils/analysis";

const CONFETTI = Array.from({ length: 26 }, (_, index) => index);

function VictoryScene() {
  return (
    <div className="analysis-victory-scene" aria-hidden="true">
      <div className="analysis-trophy">
        <Trophy size={38} fill="currentColor" />
      </div>
      <div className="analysis-crystal" />
      <div className="analysis-confetti">
        {CONFETTI.map((index) => (
          <i key={index} style={{ "--j": index }} />
        ))}
      </div>
    </div>
  );
}

function AnalysisSummary({ result }) {
  const feedback = getAnalysisFeedback(result);
  const {
    accuracy,
    scoredSections,
    bestSection,
    needsPractice,
    grade,
    advice,
    mean_deviation_semitones: meanDeviation
  } = feedback;

  const metrics = [
    [
      "Среднее отклонение",
      meanDeviation != null ? `±${meanDeviation} п/т` : "—"
    ],
    ["Проверено фрагментов", scoredSections.length || 0],
    ["Лучший фрагмент", bestSection ? `${bestSection.accuracy_percent}%` : "—"],
    [
      "Нуждается в работе",
      needsPractice ? `${needsPractice.accuracy_percent}%` : "—"
    ]
  ];

  return (
    <>
      <div className="performance-analysis-grade">{grade}</div>
      <div className="performance-analysis-score">
        {accuracy ?? "—"}
        <small>%</small>
      </div>
      <div className="text-muted">Попадание в ноты</div>
      <div className="performance-analysis-metrics performance-analysis-metrics-expanded">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="performance-analysis-advice">
        <strong>Рекомендация</strong>
        <span>{advice}</span>
      </div>
    </>
  );
}

export default function PerformanceAnalysisModal({
  recordingId,
  onClose,
  onDone,
  onDeleted
}) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const analysisRequestRef = useRef({ recordingId: null, promise: null });
  const mountedRef = useMountedRef();
  const { confirm: confirmDialog } = useAppDialog();
  const { pending: deleting, run: runDelete } = useExclusiveAsyncAction();

  useEffect(() => {
    let active = true;
    setResult(null);
    setError(null);

    if (analysisRequestRef.current.recordingId !== recordingId) {
      analysisRequestRef.current = {
        recordingId,
        promise: api.runAnalysis(recordingId)
      };
    }

    analysisRequestRef.current.promise
      .then((analysis) => {
        if (active) setResult(normalizeAnalysisResult(analysis));
      })
      .catch((analysisError) => {
        if (analysisRequestRef.current.recordingId === recordingId) {
          analysisRequestRef.current = { recordingId: null, promise: null };
        }
        if (active) {
          setError(
            getErrorMessage(analysisError, "Неизвестная ошибка анализа")
          );
        }
      });

    return () => {
      active = false;
    };
  }, [recordingId]);

  const deleteRecording = () =>
    runDelete(async () => {
      if (!(await confirmDialog("Удалить это записанное исполнение?"))) return;
      if (!mountedRef.current) return;

      try {
        await api.deleteRecording(recordingId);
        if (mountedRef.current) onDeleted?.();
      } catch (deleteError) {
        if (!mountedRef.current) return;
        setError(
          `Не удалось удалить запись: ${getErrorMessage(
            deleteError,
            "неизвестная ошибка"
          )}`
        );
      }
    });

  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabel="Анализ выступления"
      backdropClassName="app-modal-backdrop performance-analysis-backdrop"
      modalClassName="app-modal modal-card performance-analysis-modal"
      closeClassName="app-modal-close performance-analysis-close"
      closeAriaLabel="Закрыть анализ"
      closeIconSize={18}
      cardVariant="neon"
      portal
      titleProps={{
        icon: BarChart3,
        eyebrow: "РЕЗУЛЬТАТ ИСПОЛНЕНИЯ",
        title: "Анализ выступления",
        description: "Точность нот, ритм и рекомендации по исполнению.",
        actions: (result || error) ? (
          <Button
            variant="primary"
            onClick={result ? (onDone ?? onClose) : onClose}
            className="modal-title-action"
          >
            {result ? "Готово" : "Закрыть"}
          </Button>
        ) : null
      }}
    >
      <VictoryScene />
      <div className="performance-analysis-body modal-scroll">
        {!result && !error && (
          <p className="text-muted">Анализируем ноты и ритм исполнения…</p>
        )}

        {error && (
          <p className="song-lyrics-error">
            Не удалось выполнить анализ: {error}
          </p>
        )}

        {result && (
          <>
            <AnalysisSummary result={result} />
            <AudioPlayer src={api.getPerformanceFileUrl(recordingId)} />
            <div className="performance-analysis-actions performance-analysis-actions--secondary">
              <Button
                icon={Trash2}
                iconSize={14}
                variant="danger"
                onClick={deleteRecording}
                disabled={deleting}
              >
                {deleting ? "Удаляем…" : "Удалить запись"}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
