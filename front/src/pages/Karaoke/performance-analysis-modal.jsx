import { BarChart3, ChevronLeft, ChevronRight, Trash2, Trophy } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { AudioPlayer } from "../../components/AudioPlayer";
import { Button } from "../../components/fields";
import Modal from "../../components/modal";
import { useAppDialog } from "../../contexts/AppDialog";
import useExclusiveAsyncAction from "../../hooks/useExclusiveAsyncAction";
import useMountedRef from "../../hooks/useMountedRef";
import { translateSaved } from "../../i18n/runtime";
import { getErrorMessage } from "../../utils/errors";
import { getAnalysisFeedback, normalizeAnalysisResult } from "./utils/analysis";

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
      translateSaved("Среднее отклонение"),
      meanDeviation != null ? translateSaved("±{0} п/т", { 0: meanDeviation }) : "—"
    ],
    [translateSaved("Проверено фрагментов"), scoredSections.length || 0],
    [translateSaved("Лучший фрагмент"), bestSection ? `${bestSection.accuracy_percent}%` : "—"],
    [
      translateSaved("Нуждается в работе"),
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
      <div className="text-muted">{translateSaved("Попадание в ноты")}</div>
      <div className="performance-analysis-metrics performance-analysis-metrics-expanded">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="performance-analysis-advice">
        <strong>{translateSaved("Рекомендация")}</strong>
        <span>{advice}</span>
      </div>
    </>
  );
}
export function getRecordingList(recordings, recordingId) {
  const unique = new Map(
    (Array.isArray(recordings) ? recordings : [])
      .filter((recording) => recording?.id)
      .map((recording) => [String(recording.id), recording])
  );
  const activeId = String(recordingId);
  if (!unique.has(activeId)) unique.set(activeId, { id: recordingId });
  return [...unique.values()];
}

export function formatRecordingDate(value) {
  if (!value) return translateSaved("Запись исполнения");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? translateSaved("Запись исполнения") : date.toLocaleString();
}

export default function PerformanceAnalysisModal({
  recordingId,
  recordings = [],
  onClose,
  onDone,
  onDeleted
}) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [viewedRecordingId, setViewedRecordingId] = useState(recordingId);
  const analysisRequestRef = useRef({ recordingId: null, promise: null });
  const mountedRef = useMountedRef();
  const { confirm: confirmDialog } = useAppDialog();
  const { pending: deleting, run: runDelete } = useExclusiveAsyncAction();
  const recordingList = useMemo(
    () => getRecordingList(recordings, recordingId),
    [recordings, recordingId]
  );
  const viewedIndex = Math.max(
    0,
    recordingList.findIndex((recording) => String(recording.id) === String(viewedRecordingId))
  );
  const viewedRecording = recordingList[viewedIndex];
  const viewingActive = String(viewedRecording.id) === String(recordingId);
  useEffect(() => setViewedRecordingId(recordingId), [recordingId]);
  useEffect(() => {
    let active = true;
    setResult(null);
    setError(null);
    if (analysisRequestRef.current.recordingId !== recordingId) {
      analysisRequestRef.current = { recordingId, promise: api.runAnalysis(recordingId) };
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
          setError(getErrorMessage(analysisError, translateSaved("Неизвестная ошибка анализа")));
        }
      });
    return () => {
      active = false;
    };
  }, [recordingId]);
  const deleteRecording = () =>
    runDelete(async () => {
      if (!(await confirmDialog(translateSaved("Удалить это записанное исполнение?")))) return;
      if (!mountedRef.current) return;
      try {
        await api.deleteRecording(recordingId);
        if (mountedRef.current) onDeleted?.();
      } catch (deleteError) {
        if (!mountedRef.current) return;
        setError(
          translateSaved("Не удалось удалить запись: {0}", {
            0: getErrorMessage(deleteError, translateSaved("неизвестная ошибка"))
          })
        );
      }
    });
  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabel={translateSaved("Анализ выступления")}
      backdropClassName="app-modal-backdrop performance-analysis-backdrop"
      modalClassName="app-modal modal-card performance-analysis-modal"
      closeClassName="app-modal-close performance-analysis-close"
      closeAriaLabel={translateSaved("Закрыть анализ")}
      closeIconSize={18}
      cardVariant="neon"
      portal
      titleProps={{
        icon: BarChart3,
        eyebrow: translateSaved("РЕЗУЛЬТАТ ИСПОЛНЕНИЯ"),
        title: translateSaved("Анализ выступления"),
        description: translateSaved("Точность нот, ритм и рекомендации по исполнению."),
        actions:
          result || error ? (
            <Button
              variant="primary"
              onClick={result ? (onDone ?? onClose) : onClose}
              className="modal-title-action"
            >
              {result ? translateSaved("Готово") : translateSaved("Закрыть")}
            </Button>
          ) : null
      }}
    >
      <VictoryScene />
      <div className="performance-analysis-body modal-scroll">
        {recordingList.length > 1 && (
          <div
            className="performance-analysis-carousel"
            aria-label={translateSaved("Записи исполнения")}
          >
            <Button
              icon={ChevronLeft}
              variant="ghost"
              aria-label={translateSaved("Предыдущая запись")}
              disabled={viewedIndex === 0}
              onClick={() => setViewedRecordingId(recordingList[viewedIndex - 1].id)}
            />
            <div className="performance-analysis-recording-meta" aria-live="polite">
              <strong>{formatRecordingDate(viewedRecording.created_at)}</strong>
              <span>
                {translateSaved("Запись {0} из {1}", {
                  0: viewedIndex + 1,
                  1: recordingList.length
                })}
                {viewingActive ? ` · ${translateSaved("анализируется")}` : ""}
              </span>
            </div>
            <Button
              icon={ChevronRight}
              variant="ghost"
              aria-label={translateSaved("Следующая запись")}
              disabled={viewedIndex === recordingList.length - 1}
              onClick={() => setViewedRecordingId(recordingList[viewedIndex + 1].id)}
            />
          </div>
        )}

        <AudioPlayer src={api.getPerformanceFileUrl(viewedRecording.id)} />

        {!viewingActive && (
          <p className="text-muted">
            {translateSaved(
              "Вы просматриваете другую запись. Текущий анализ продолжает выполняться без переключения."
            )}
          </p>
        )}

        {viewingActive && !result && !error && (
          <p className="text-muted">{translateSaved("Анализируем ноты и ритм исполнения…")}</p>
        )}

        {viewingActive && error && (
          <p className="song-lyrics-error">
            {translateSaved("Не удалось выполнить анализ:")}
            {error}
          </p>
        )}

        {viewingActive && result && (
          <>
            <AnalysisSummary result={result} />
            <div className="performance-analysis-actions performance-analysis-actions--secondary">
              <Button
                icon={Trash2}
                iconSize={14}
                variant="danger"
                onClick={deleteRecording}
                disabled={deleting}
              >
                {deleting ? translateSaved("Удаляем…") : translateSaved("Удалить запись")}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
