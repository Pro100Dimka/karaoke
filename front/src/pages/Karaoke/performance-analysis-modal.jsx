import { BarChart3, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { AudioPlayer } from "../../components/AudioPlayer";
import { useAppDialog } from "../../contexts/AppDialog";
import useExclusiveAsyncAction from "../../hooks/useExclusiveAsyncAction";
import useMountedRef from "../../hooks/useMountedRef";
import { translateSaved as t } from "../../i18n/runtime";
import {
  Button,
  Card,
  Grid,
  Modal,
  ModalCarouselNavigation,
  Stack,
  Typography
} from "../../theme/ui";
import { getErrorMessage } from "../../utils/errors";
import { getAnalysisFeedback, normalizeAnalysisResult } from "./utils/analysis";

export const getRecordingList = (recordings, recordingId) => {
  const unique = new Map(
    (Array.isArray(recordings) ? recordings : [])
      .filter((recording) => recording?.id)
      .map((recording) => [String(recording.id), recording])
  );
  if (!unique.has(String(recordingId))) unique.set(String(recordingId), { id: recordingId });
  return [...unique.values()];
};
export const formatRecordingDate = (value) => {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date.toLocaleString() : t("Запись исполнения");
};

function Summary({ result }) {
  const feedback = getAnalysisFeedback(result);
  const metrics = [
    [
      t("Среднее отклонение"),
      feedback.mean_deviation_semitones != null
        ? t("±{0} п/т", { 0: feedback.mean_deviation_semitones })
        : "—"
    ],
    [t("Проверено фрагментов"), feedback.scoredSections.length],
    [
      t("Лучший фрагмент"),
      feedback.bestSection ? `${feedback.bestSection.accuracy_percent}%` : "—"
    ],
    [
      t("Нуждается в работе"),
      feedback.needsPractice ? `${feedback.needsPractice.accuracy_percent}%` : "—"
    ]
  ];
  return (
    <Stack align="center" gap="var(--space-4)">
      <Typography variant="h2">{feedback.grade}</Typography>
      <Typography data-role="analysis-score" variant="h1">
        {feedback.accuracy ?? "—"}%
      </Typography>
      <Typography tone="muted">{t("Попадание в ноты")}</Typography>
      <Grid columns={2} gap="var(--space-3)">
        {metrics.map(([label, value]) => (
          <Card key={label} cardContent={{ style: { padding: "var(--space-4)" } }}>
            <Stack gap="var(--space-1)">
              <Typography variant="caption" tone="muted">
                {label}
              </Typography>
              <Typography>
                <strong>{value}</strong>
              </Typography>
            </Stack>
          </Card>
        ))}
      </Grid>
      <Card variant="laser" tilt={false} cardContent={{ style: { padding: "var(--space-4)" } }}>
        <Stack gap="var(--space-2)">
          <Typography>
            <strong>{t("Рекомендация")}</strong>
          </Typography>
          <Typography tone="muted">{feedback.advice}</Typography>
        </Stack>
      </Card>
    </Stack>
  );
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
  const [viewedId, setViewedId] = useState(recordingId);
  const request = useRef({ recordingId: null, promise: null });
  const mounted = useMountedRef();
  const { confirm } = useAppDialog();
  const { pending: deleting, run } = useExclusiveAsyncAction();
  const list = useMemo(() => getRecordingList(recordings, recordingId), [recordings, recordingId]);
  const index = Math.max(
    0,
    list.findIndex(({ id }) => String(id) === String(viewedId))
  );
  const viewed = list[index];
  const active = String(viewed.id) === String(recordingId);
  useEffect(() => setViewedId(recordingId), [recordingId]);
  useEffect(() => {
    let subscribed = true;
    setResult(null);
    setError(null);
    if (request.current.recordingId !== recordingId)
      request.current = { recordingId, promise: api.runAnalysis(recordingId) };
    request.current.promise
      .then((value) => subscribed && setResult(normalizeAnalysisResult(value)))
      .catch((reason) => {
        if (request.current.recordingId === recordingId)
          request.current = { recordingId: null, promise: null };
        if (subscribed) setError(getErrorMessage(reason, t("Неизвестная ошибка анализа")));
      });
    return () => {
      subscribed = false;
    };
  }, [recordingId]);
  const remove = () =>
    run(async () => {
      if (!(await confirm(t("Удалить это записанное исполнение?"))) || !mounted.current) return;
      try {
        await api.deleteRecording(recordingId);
        if (mounted.current) onDeleted?.();
      } catch (reason) {
        if (mounted.current)
          setError(
            t("Не удалось удалить запись: {0}", {
              0: getErrorMessage(reason, t("неизвестная ошибка"))
            })
          );
      }
    });
  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabel={t("Анализ выступления")}
      cardVariant="laser"
      portal
      titleProps={{
        icon: BarChart3,
        eyebrow: t("РЕЗУЛЬТАТ ИСПОЛНЕНИЯ"),
        title: t("Анализ выступления"),
        description: t("Точность нот, ритм и рекомендации по исполнению."),
        actions: (result || error) && (
          <Button variant="contained" onClick={result ? (onDone ?? onClose) : onClose}>
            {result ? t("Готово") : t("Закрыть")}
          </Button>
        )
      }}
    >
      <Stack gap="var(--space-4)" sx={{ padding: "var(--space-4)" }}>
        <ModalCarouselNavigation
          ariaLabel={t("Записи исполнения")}
          index={index}
          count={list.length}
          title={formatRecordingDate(viewed.created_at)}
          subtitle={`${t("Запись {0} из {1}", { 0: index + 1, 1: list.length })}${active ? ` · ${t("анализируется")}` : ""}`}
          previousLabel={t("Предыдущая запись")}
          nextLabel={t("Следующая запись")}
          onPrevious={() => setViewedId(list[index - 1].id)}
          onNext={() => setViewedId(list[index + 1].id)}
        />
        {!active && (
          <>
            <Typography tone="muted">
              {t(
                "Вы просматриваете другую запись. Текущий анализ продолжает выполняться без переключения."
              )}
            </Typography>
            <AudioPlayer src={api.getPerformanceFileUrl(viewed.id)} />
          </>
        )}
        {active && !result && !error && (
          <Typography role="status" tone="muted">
            {t("Анализируем ноты и ритм исполнения…")}
          </Typography>
        )}
        {active && error && (
          <Typography role="alert" tone="danger">
            {t("Не удалось выполнить анализ:")} {error}
          </Typography>
        )}
        {active && result && (
          <>
            <Summary result={result} />
            <AudioPlayer src={api.getPerformanceFileUrl(viewed.id)} />
            <Button
              variant="contained"
              data-role="delete-recording"
              tone="danger"
              startIcon={<Trash2 />}
              disabled={deleting}
              onClick={remove}
            >
              {deleting ? t("Удаляем…") : t("Удалить запись")}
            </Button>
          </>
        )}
      </Stack>
    </Modal>
  );
}
