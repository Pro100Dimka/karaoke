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
  IconButton,
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
  return value && !Number.isNaN(date.getTime())
    ? date.toLocaleString()
    : t("karaoke.performanceRecording");
};

function Summary({ result }) {
  const feedback = getAnalysisFeedback(result);
  const metrics = [
    [
      "pitch",
      t("karaoke.hittingTheNotes"),
      feedback.pitch_accuracy_percent,
      t("karaoke.accurateNotesWithinHalfASemitone")
    ],
    [
      "rhythm",
      t("karaoke.rhythmAndEntries"),
      feedback.rhythm_accuracy_percent,
      t("karaoke.noteOnsetAccuracyRelativeToTheBackingTrack")
    ],
    [
      "hold",
      t("karaoke.noteSustain"),
      feedback.note_hold_percent,
      t("karaoke.stablePitchThroughoutEachNote")
    ],
    [
      "coverage",
      t("karaoke.performanceCompleteness"),
      feedback.note_coverage_percent,
      t("karaoke.proportionOfSongNotesWithDetectedVoice")
    ]
  ];
  return (
    <Stack align="center" gap="var(--space-4)">
      <Grid columns={2} gap="var(--space-3)">
        {metrics.map(([key, label, value, description]) => (
          <Card key={key} data-practice={feedback.practiceMetric?.key === key || undefined}>
            <Stack gap="var(--space-1)" sx={{ padding: "var(--space-3)" }}>
              <Stack direction="row" align="baseline" justify="space-between" gap="var(--space-2)">
                <Typography>
                  <strong>{label}</strong>
                </Typography>
                <Typography variant="h4">{value == null ? "—" : `${value}%`}</Typography>
              </Stack>
              <Typography variant="caption" tone="muted">
                {description}
              </Typography>
            </Stack>
          </Card>
        ))}
      </Grid>
      <Card variant="laser" tilt={false} cardContent={{ style: { padding: "var(--space-4)" } }}>
        <Stack align="center" gap="var(--space-1)">
          <Typography variant="h4" textAlign="center">
            {feedback.grade}
          </Typography>
          <Typography data-role="analysis-score" variant="h3">
            {feedback.accuracy ?? "—"}%
          </Typography>
          <Typography tone="muted">{t("karaoke.overallPerformanceScore")}</Typography>
          <Typography variant="caption" tone="muted" textAlign="center">
            {t("karaoke.totalNotes50Rhythm25Sustain15Completeness10")}
          </Typography>
        </Stack>
        <Stack gap="var(--space-2)">
          <Typography>
            <strong>{t("karaoke.recommendation")}</strong>
          </Typography>
          <Typography tone="muted">{feedback.advice}</Typography>
          {feedback.needsPractice && (
            <Typography variant="caption" tone="muted">
              {t("karaoke.mostDifficultSection", { 0: feedback.needsPractice.accuracy_percent })}
            </Typography>
          )}
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
        if (subscribed) setError(getErrorMessage(reason, t("karaoke.unknownParsingError")));
      });
    return () => {
      subscribed = false;
    };
  }, [recordingId]);
  const remove = () =>
    run(async () => {
      if (!(await confirm(t("karaoke.shouldIDeleteThisRecordedPerformance"))) || !mounted.current)
        return;
      try {
        await api.deleteRecording(recordingId);
        if (mounted.current) onDeleted?.();
      } catch (reason) {
        if (mounted.current)
          setError(
            t("karaoke.failedToDeleteEntry", {
              0: getErrorMessage(reason, t("room.transfer.unknownError"))
            })
          );
      }
    });
  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabel={t("karaoke.analysisOfTheSpeech")}
      cardVariant="laser"
      portal
      titleProps={{
        icon: BarChart3,
        eyebrow: t("karaoke.executionResult"),
        title: t("karaoke.analysisOfTheSpeech"),
        description: t("karaoke.accuracyOfNotesRhythmAndPerformanceRecommendations"),
        actions: (result || error) && (
          <Button variant="contained" onClick={result ? (onDone ?? onClose) : onClose}>
            {result ? t("status.done") : t("common.close")}
          </Button>
        )
      }}
    >
      <Stack gap="var(--space-4)" sx={{ padding: "var(--space-4)" }}>
        <ModalCarouselNavigation
          ariaLabel={t("karaoke.performanceRecordings")}
          index={index}
          count={list.length}
          title={formatRecordingDate(viewed.created_at)}
          subtitle={`${t("karaoke.recordingOf", { 0: index + 1, 1: list.length })}${active ? ` · ${t("karaoke.beingAnalyzed")}` : ""}`}
          previousLabel={t("karaoke.previousRecording")}
          nextLabel={t("karaoke.nextRecording")}
          onPrevious={() => setViewedId(list[index - 1].id)}
          onNext={() => setViewedId(list[index + 1].id)}
        />
        {!active && (
          <>
            <Typography tone="muted">
              {t("karaoke.youAreViewingAnotherRecordingTheCurrentAnalysisContinues")}
            </Typography>
            <AudioPlayer
              src={api.getPerformanceFileUrl(viewed.id)}
              initialDuration={viewed.duration_sec}
            />
          </>
        )}
        {active && !result && !error && (
          <Typography role="status" tone="muted">
            {t("karaoke.weAnalyzeTheNotesAndRhythmOfPerformance")}
          </Typography>
        )}
        {active && error && (
          <Typography role="alert" tone="danger">
            {t("karaoke.analysisFailed")} {error}
          </Typography>
        )}
        {active && result && (
          <>
            <Summary result={result} />
            <Stack direction="row" align="center" gap="var(--space-2)">
              <AudioPlayer
                src={api.getPerformanceFileUrl(viewed.id)}
                initialDuration={viewed.duration_sec}
              />
              <IconButton
                icon={Trash2}
                data-role="delete-recording"
                tone="danger"
                label={deleting ? t("karaoke.deletingRecording") : t("karaoke.deleteEntry")}
                disabled={deleting}
                onClick={remove}
              />
            </Stack>
          </>
        )}
      </Stack>
    </Modal>
  );
}
