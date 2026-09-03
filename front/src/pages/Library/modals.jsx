import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleDot,
  Library,
  Music2,
  OctagonX,
  Pause,
  Play,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { AudioPlayer } from "../../components/AudioPlayer";
import { toggleAudioPlayback } from "../../components/audio-player-utils";
import useSongCover from "../../hooks/useSongCover";
import { translateSaved as tr } from "../../i18n/runtime";
import ProcessingSignal from "../../theme/features/ProcessingSignal";
import {
  Box,
  Button,
  Card,
  Chip,
  IconButton,
  Modal,
  RenderFormikFields,
  Stack,
  Typography,
  useGetForm
} from "../../theme/ui";
import * as platform from "../../utils/platform";
import { getProcessingModeOptions } from "./processing-modes";
import { formatEta, getProcessingProgress, isProcessingActive } from "./utils";

const formatFinishTime = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

export function SelectedFilePreview({ file }) {
  const audio = useRef(null);
  const [source, setSource] = useState("");
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== "function") return undefined;
    const url = URL.createObjectURL(file);
    const element = audio.current;
    setSource(url);
    return () => {
      element?.pause();
      URL.revokeObjectURL(url);
    };
  }, [file]);
  const Icon = playing ? Pause : Play;
  const label = playing
    ? tr("library.pauseSelectedAudioFile")
    : tr("library.previewSelectedAudioFile");
  return (
    <>
      <IconButton
        label={label}
        variant={playing ? "contained" : "outlined"}
        size="lg"
        disabled={!source}
        onClick={async () => setPlaying(await toggleAudioPlayback(audio.current))}
      >
        <Icon size={19} fill={playing ? "currentColor" : "none"} />
      </IconButton>
      <audio
        ref={audio}
        src={source}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </>
  );
}

export function AddSongsModal({ review, onCancel, onConfirm }) {
  const item = review?.items?.[review.index];
  const formik = useGetForm({
    initialValues: {
      artist: item?.artist || "",
      title: item?.title || "",
      processingMode: item?.processingMode || ""
    },
    onSubmit: async (values) => {
      if (values.title.trim()) await onConfirm(values);
    }
  });
  return (
    <Modal
      isOpen={Boolean(item)}
      onClose={onCancel}
      ariaLabel={tr("library.confirmAddingSong")}
      titleProps={{
        icon: Music2,
        image: item?.coverUrl || undefined,
        eyebrow: item ? tr("library.songOf", { 0: review.index + 1, 1: review.items.length }) : "",
        title: tr("library.checkSongDetails"),
        description: tr("library.processingStartsOnlyAfterAllFilesAreConfirmed"),
        actions: item ? (
          <>
            <Button variant="outlined" type="button" onClick={onCancel}>
              {tr("library.skip")}
            </Button>
            <Button
              variant="contained"
              type="button"
              disabled={!formik.values.title.trim() || formik.isSubmitting}
              onClick={formik.submitForm}
            >
              {tr("common.confirm")}
            </Button>
          </>
        ) : undefined
      }}
    >
      {item && (
        <Box as="form" onSubmit={formik.handleSubmit} sx={{ padding: "var(--space-5)" }}>
          <RenderFormikFields
            formik={formik}
            items={[
              {
                tag: "artist",
                type: "TextField",
                label: tr("library.sort.artist"),
                size: "lg",
                required: true,
                xs: 12,
                md: 4
              },
              {
                tag: "title",
                type: "TextField",
                label: tr("library.songTitle"),
                size: "lg",
                required: true,
                xs: 12,
                md: 4
              },
              {
                tag: "processingMode",
                type: "SelectField",
                label: tr("library.processingMode"),
                size: "lg",
                options: getProcessingModeOptions(),
                xs: 10,
                md: 3
              },
              {
                tag: "preview",
                type: "custom",
                xs: 2,
                md: 1,
                render: () => <SelectedFilePreview file={item.file} />
              }
            ]}
          />
        </Box>
      )}
    </Modal>
  );
}

export function getProcessingFailureInfo(message) {
  const raw = String(message || "").trim();
  const separator = raw.indexOf(":");
  const normalized = raw.toLowerCase();
  const hint =
    normalized.includes("ctc") || normalized.includes("model unavailable")
      ? tr("library.alignmentModelUnavailableCheckTheAiModelInstallationAnd")
      : normalized.includes("timestamp") || normalized.includes("interval")
        ? tr("library.couldNotAlignWordIntervalsToVocalsCheckThe")
        : tr("library.retryProcessingIfTheErrorPersistsOpenTheExecution");
  return {
    type: separator > 0 ? raw.slice(0, separator).trim() : "ProcessingError",
    reason:
      (separator > 0 ? raw.slice(separator + 1).trim() : raw) ||
      tr("library.backendDidNotProvideAReason"),
    hint
  };
}

const statusLabels = {
  done: () => tr("status.done"),
  error: () => tr("status.error"),
  cancelled: () => tr("status.cancelled"),
  processing: () => tr("status.processing"),
  queued: () => tr("status.queued"),
  cancelling: () => tr("library.cancelling")
};

export function ProcessingModal({
  song,
  songs = [],
  status,
  onCancel,
  onClose,
  onOpenKaraoke,
  onSelectSong
}) {
  const token = platform.apiToken();
  const waveformFetchParams = useMemo(
    () => (token ? { headers: { "X-ADVoice-Token": token } } : undefined),
    [token]
  );
  const current = !status?.song_id || status.song_id === song?.id ? status : null;
  const state = current?.status ?? song?.status;
  const { coverUrl, hasCover, handleCoverError } = useSongCover(song?.id, state);
  if (!song) return null;
  const progress = getProcessingProgress(current, song);
  const active = isProcessingActive(state);
  const symbolicSource = /\.(?:kar|mid|kfn)$/i.test(String(song.original_filename || ""));
  const waveformUrl =
    !symbolicSource || progress >= 34 ? api.getAudioTrackUrl(song.id, "song") : undefined;
  const failed = state === "error";
  const cancelled = state === "cancelled";
  const failure = failed
    ? getProcessingFailureInfo(current?.error_message ?? song.error_message)
    : null;
  const queue = songs.some(({ id }) => id === song.id) ? songs : [song, ...songs];
  const index = queue.findIndex(({ id }) => id === song.id);
  const actions = [
    active && (
      <Button key="cancel" variant="contained" startIcon={<OctagonX />} onClick={onCancel}>
        {tr("library.cancel")}
      </Button>
    ),
    state === "done" && (
      <Button key="library" variant="outlined" startIcon={<Library />} onClick={onClose}>
        {tr("library.toTheLibrary")}
      </Button>
    ),
    state === "done" && (
      <Button
        key="open"
        variant="contained"
        startIcon={<Play />}
        onClick={() => onOpenKaraoke(song.id)}
      >
        {tr("library.open")}
      </Button>
    )
  ].filter(Boolean);
  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabel={tr("library.songProcessing", { 0: song.title })}
      titleProps={{
        icon: CircleDot,
        image: hasCover ? coverUrl : undefined,
        onImageError: handleCoverError,
        eyebrow: tr("library.songProcessing2"),
        title: song.title,
        description: tr("library.followThePreparationStagesAndManageTheSongProcessing"),
        actions
      }}
    >
      <Stack gap={1} sx={{ padding: "var(--space-5)" }}>
        {queue.length > 1 && (
          <Stack direction="row" align="center" justify="space-between" gap={1}>
            <IconButton
              label={tr("library.previousSong")}
              variant="outline"
              disabled={index <= 0}
              onClick={() => onSelectSong(queue[index - 1])}
            >
              <ChevronLeft />
            </IconButton>
            <Stack align="center" gap={0.1}>
              <Typography sx={{ fontWeight: 750 }}>
                {tr("library.songOf", { 0: index + 1, 1: queue.length })}
              </Typography>
              <Typography variant="caption" tone="muted">
                {song.artist || tr("library.artistNotSpecified")}
              </Typography>
            </Stack>
            <IconButton
              label={tr("library.nextSong")}
              variant="outline"
              disabled={index >= queue.length - 1}
              onClick={() => onSelectSong(queue[index + 1])}
            >
              <ChevronRight />
            </IconButton>
          </Stack>
        )}
        <Chip
          tone={failed ? "danger" : state === "done" ? "success" : "default"}
          sx={{ alignSelf: "flex-start" }}
        >
          {statusLabels[state]?.() || state || tr("status.pending")}
        </Chip>
        {!failed && !cancelled && (
          <ProcessingSignal
            progress={state === "done" ? 100 : Math.max(active ? 1 : 0, progress)}
            url={waveformUrl}
            fetchParams={waveformFetchParams}
          />
        )}
        {failure ? (
          <Card
            role="alert"
            sx={{ padding: "var(--space-4)", border: "var(--hairline) solid var(--ui-danger)" }}
          >
            <Stack gap={0.75}>
              <Stack direction="row" align="center" gap={0.5}>
                <CircleAlert size={20} />
                <Typography sx={{ fontWeight: 800 }}>{tr("library.processingStopped")}</Typography>
              </Stack>
              <Typography tone="danger">{failure.reason}</Typography>
              <GridInfo
                items={[
                  [tr("library.errorType"), failure.type],
                  [
                    tr("library.stage"),
                    current?.progress_detail ??
                      current?.progress_step ??
                      song.progress_step ??
                      tr("library.notSpecified")
                  ],
                  [tr("library.completed"), `${Math.round(progress)}%`]
                ]}
              />
              <Typography variant="body2" tone="muted">
                {failure.hint}
              </Typography>
              <Button variant="outlined" onClick={() => platform.openApplicationLog()}>
                {tr("library.openExecutionLog")}
              </Button>
            </Stack>
          </Card>
        ) : (
          <Stack gap={0.4}>
            <Stack direction="row" justify="space-between" gap={1}>
              <Typography>
                {state === "done"
                  ? tr("library.theSongIsReadyForKaraoke")
                  : cancelled
                    ? tr("library.processingCancelled")
                    : (current?.progress_detail ??
                      current?.progress_step ??
                      tr("library.preparingTheSongProcessing"))}
              </Typography>
              {active && (
                <Typography sx={{ fontWeight: 800 }}>
                  {current?.eta_seconds == null
                    ? tr("library.estimatingTime")
                    : `${tr("library.left")} ${formatEta(current.eta_seconds)}`}
                </Typography>
              )}
            </Stack>
            {active && current?.stage_elapsed_seconds != null && (
              <Typography variant="caption" tone="muted">
                {tr("library.currentStage")} {formatEta(current.stage_elapsed_seconds)} ·{" "}
                {tr("library.total")} {formatEta(current.total_elapsed_seconds)} ·{" "}
                {tr("library.estimatedCompletion")} {formatFinishTime(current.estimated_finish_at)}
              </Typography>
            )}
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}

const GridInfo = ({ items }) => (
  <Stack direction="row" gap={0.75} wrap>
    {items.map(([label, value]) => (
      <Card key={label} sx={{ flex: 1, padding: "var(--space-3)" }}>
        <Typography variant="caption" tone="muted">
          {label}
        </Typography>
        <Typography sx={{ fontWeight: 750, overflowWrap: "anywhere" }}>{value}</Typography>
      </Card>
    ))}
  </Stack>
);

export function RecordingsModal({ song, recordings = [], error, onAnalyze, onClose, onDelete }) {
  if (!song) return null;
  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabel={tr("library.songPerformances", { 0: song.title })}
      titleProps={{
        icon: Music2,
        eyebrow: tr("library.songPerformances2"),
        title: song.title,
        description: tr("library.listenToPerformancesRunAnalyzesAndManageRecordings")
      }}
    >
      <Stack gap={0.75} sx={{ padding: "var(--space-5)" }}>
        {recordings.map((recording) => (
          <Card
            key={recording.id}
            sx={{
              padding: "var(--space-3)",
              background: "unset",
              border: "unset",
              boxShadow: "unset",
              backdropFilter: "unset"
            }}
          >
            <Stack direction="row" align="center" gap={0.75}>
              <Box sx={{ flex: 1 }}>
                <AudioPlayer
                  src={api.getPerformanceFileUrl(recording.id)}
                  initialDuration={recording.duration_sec}
                />
              </Box>
              <IconButton
                label={tr("library.analyzeRecord")}
                variant="outline"
                onClick={() => onAnalyze(recording)}
              >
                <BarChart3 />
              </IconButton>
              <IconButton
                label={tr("karaoke.deleteEntry")}
                variant="danger"
                onClick={() => onDelete(recording)}
              >
                <Trash2 />
              </IconButton>
            </Stack>
          </Card>
        ))}
        {!recordings.length && !error && (
          <Typography tone="muted" sx={{ textAlign: "center", padding: "var(--space-8)" }}>
            {tr("library.thereAreNoRecordedPerformancesForThisSongYet")}
          </Typography>
        )}
        {error && (
          <Typography role="alert" tone="danger">
            {error instanceof Error ? error.message : String(error)}
          </Typography>
        )}
      </Stack>
    </Modal>
  );
}
