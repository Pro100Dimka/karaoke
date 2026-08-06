import { BarChart3, Trash2, Trophy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../api/client";
import { AudioPlayer } from "../../../components/AudioPlayer";
import { Button } from "../../../components/fields";
import Modal from "../../../components/modal";
import ModalTitle from "../../../components/modal/title";
import { useAppDialog } from "../../../contexts/AppDialog";
import useExclusiveAsyncAction from "../../../hooks/useExclusiveAsyncAction";
import useMountedRef from "../../../hooks/useMountedRef";
import { getErrorMessage } from "../../../utils/errors";
import {
  getAnalysisFeedback,
  normalizeAnalysisResult
} from "../utils/analysis";

export default function PerformanceAnalysisModal({
  recordingId,
  onClose,
  onDone,
  onDeleted
}) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const { pending: deleting, run: runDelete } = useExclusiveAsyncAction();
  const analysisRequestRef = useRef({ recordingId: null, promise: null });
  const mountedRef = useMountedRef();
  const { confirm: confirmDialog } = useAppDialog();

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
        if (mountedRef.current) onDeleted();
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
    >
      <div className="analysis-victory-scene" aria-hidden="true">
        <div className="analysis-trophy">
          <Trophy size={38} fill="currentColor" />
        </div>
        <div className="analysis-crystal" />
        <div className="analysis-confetti">
          {Array.from({ length: 26 }, (_, index) => (
            <i key={index} style={{ "--j": index }} />
          ))}
        </div>
      </div>
      <ModalTitle
        icon={BarChart3}
        eyebrow="РЕЗУЛЬТАТ ИСПОЛНЕНИЯ"
        title="Анализ выступления"
        description="Точность нот, ритм и рекомендации по исполнению."
      />
      <div className="performance-analysis-body modal-scroll">
        {!result && !error && (
          <p className="text-muted">Анализируем ноты и ритм исполнения…</p>
        )}
        {error && (
          <>
            <p className="song-lyrics-error">
              Не удалось выполнить анализ: {error}
            </p>
            <Button variant="primary" onClick={onClose}>
              Закрыть
            </Button>
          </>
        )}
        {result && (
          <>
            <AnalysisSummary result={result} />
            <AudioPlayer src={api.getPerformanceFileUrl(recordingId)} />
            <div className="performance-analysis-actions">
              <Button
                icon={Trash2}
                iconSize={14}
                variant="danger"
                onClick={deleteRecording}
                disabled={deleting}
              >
                {deleting ? "Удаляем…" : "Удалить запись"}
              </Button>
              <Button variant="primary" onClick={onDone}>
                Готово
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function AnalysisSummary({ result }) {
  const {
    accuracy,
    scoredSections,
    bestSection,
    needsPractice,
    grade,
    advice,
    mean_deviation_semitones: meanDeviation
  } = getAnalysisFeedback(result);

  return (
    <>
      <div className="performance-analysis-grade">{grade}</div>
      <div className="performance-analysis-score">
        {accuracy ?? "—"}
        <small>%</small>
      </div>
      <div className="text-muted">Попадание в ноты</div>
      <div className="performance-analysis-metrics performance-analysis-metrics-expanded">
        <div>
          <span>Среднее отклонение</span>
          <strong>
            {meanDeviation != null ? `±${meanDeviation} п/т` : "—"}
          </strong>
        </div>
        <div>
          <span>Проверено фрагментов</span>
          <strong>{scoredSections.length || 0}</strong>
        </div>
        <div>
          <span>Лучший фрагмент</span>
          <strong>
            {bestSection ? `${bestSection.accuracy_percent}%` : "—"}
          </strong>
        </div>
        <div>
          <span>Нуждается в работе</span>
          <strong>
            {needsPractice ? `${needsPractice.accuracy_percent}%` : "—"}
          </strong>
        </div>
      </div>
      <div className="performance-analysis-advice">
        <strong>Рекомендация</strong>
        <span>{advice}</span>
      </div>
    </>
  );
}
