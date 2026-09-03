import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleDot,
  Library,
  OctagonX,
  Play
} from "lucide-react";
import { api } from "../../../api/client";
import useSongCover from "../../../hooks/useSongCover";
import { translateSaved as tr } from "../../../i18n/runtime";
import ProcessingSignal from "../../../theme/features/ProcessingSignal";
import { Button, Card, Chip, IconButton, Modal, Stack, Typography } from "../../../theme/ui";
import * as platform from "../../../utils/platform";
import { formatEta, getProcessingProgress, isProcessingActive } from "../utils";

export function getProcessingFailureInfo(message) {
  const raw = String(message || "").trim();
  const split = raw.indexOf(":");
  const text = raw.toLowerCase();
  const hint = /ctc|model unavailable/.test(text)
    ? "library.alignmentModelUnavailableCheckTheAiModelInstallationAnd"
    : /timestamp|interval/.test(text)
      ? "library.couldNotAlignWordIntervalsToVocalsCheckThe"
      : "library.retryProcessingIfTheErrorPersistsOpenTheExecution";
  return {
    type: split > 0 ? raw.slice(0, split).trim() : "ProcessingError",
    reason:
      (split > 0 ? raw.slice(split + 1).trim() : raw) || tr("library.backendDidNotProvideAReason"),
    hint: tr(hint)
  };
}
const finishTime = (value) => {
  const date = new Date(value);
  return value && !Number.isNaN(+date)
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";
};
const actionButtons = (items) =>
  items.filter(Boolean).map(([key, Icon, variant, label, onClick]) => (
    <Button key={key} variant={variant} startIcon={<Icon />} onClick={onClick}>
      {tr(label)}
    </Button>
  ));
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
const statusLabel = (status) =>
  tr(status === "cancelling" ? "library.cancelling" : `status.${status || "pending"}`);
export default ({ song, songs = [], status, onCancel, onClose, onOpenKaraoke, onSelectSong }) => {
  const current = status?.song_id && status.song_id !== song?.id ? null : status;
  const state = current?.status ?? song?.status;
  const { coverUrl, hasCover, handleCoverError } = useSongCover(song?.id, state);
  if (!song) return null;

  const progress = getProcessingProgress(current, song);
  const active = isProcessingActive(state);
  const done = state === "done";
  const failed = state === "error";
  const cancelled = state === "cancelled";
  const failure = failed
    ? getProcessingFailureInfo(current?.error_message ?? song.error_message)
    : null;
  const queue = songs.some(({ id }) => id === song.id) ? songs : [song, ...songs];
  const index = queue.findIndex(({ id }) => id === song.id);
  const token = platform.apiToken();
  const fetchParams = token ? { headers: { "X-ADVoice-Token": token } } : undefined;
  const stage =
    current?.progress_detail ??
    current?.progress_step ??
    song.progress_step ??
    tr("library.preparingTheSongProcessing");
  const waveformUrl =
    !/\.(?:kar|mid|kfn)$/i.test(song.original_filename || "") || progress >= 34
      ? api.getAudioTrackUrl(song.id, "song")
      : undefined;
  const actions = actionButtons([
    active && ["cancel", OctagonX, "contained", "library.cancel", onCancel],
    done && ["library", Library, "outlined", "library.toTheLibrary", onClose],
    done && ["open", Play, "contained", "library.open", () => onOpenKaraoke(song.id)]
  ]);
  const nav = (offset, Icon, label) => (
    <IconButton
      label={tr(label)}
      variant="outline"
      disabled={index + offset < 0 || index + offset >= queue.length}
      onClick={() => onSelectSong(queue[index + offset])}
    >
      <Icon />
    </IconButton>
  );

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
            {nav(-1, ChevronLeft, "library.previousSong")}
            <Stack align="center" gap={0.1}>
              <Typography sx={{ fontWeight: 750 }}>
                {tr("library.songOf", { 0: index + 1, 1: queue.length })}
              </Typography>
              <Typography variant="caption" tone="muted">
                {song.artist || tr("library.artistNotSpecified")}
              </Typography>
            </Stack>
            {nav(1, ChevronRight, "library.nextSong")}
          </Stack>
        )}

        <Chip
          tone={failed ? "danger" : done ? "success" : "default"}
          sx={{ alignSelf: "flex-start" }}
        >
          {statusLabel(state)}
        </Chip>

        {!failed && !cancelled && (
          <ProcessingSignal
            progress={done ? 100 : Math.max(active ? 1 : 0, progress)}
            url={waveformUrl}
            fetchParams={fetchParams}
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
              <Button variant="outlined" onClick={platform.openApplicationLog}>
                {tr("library.openExecutionLog")}
              </Button>
            </Stack>
          </Card>
        ) : (
          <Stack gap={0.4}>
            <Stack direction="row" justify="space-between" gap={1}>
              <Typography>
                {done
                  ? tr("library.theSongIsReadyForKaraoke")
                  : cancelled
                    ? tr("library.processingCancelled")
                    : stage}
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
                {tr("library.estimatedCompletion")} {finishTime(current.estimated_finish_at)}
              </Typography>
            )}
          </Stack>
        )}
      </Stack>
    </Modal>
  );
};
