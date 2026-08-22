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
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { AudioPlayer } from "../../components/AudioPlayer";
import { toggleAudioPlayback } from "../../components/audio-player-utils";
import { translateSaved as tr } from "../../i18n/runtime";
import {
  Box,
  Button,
  Card,
  Chip,
  IconButton,
  Modal,
  Select,
  Stack,
  TextField,
  Typography
} from "../../theme/ui";
import { ProcessingSignal } from "./components";
import useSongCover from "./hooks/useSongCover";
import { getProcessingModeOptions } from "./processing-modes";
import { formatEta, getProcessingProgress, isProcessingActive } from "./utils";

export function SelectedFilePreview({ file }) {
  const audio = useRef(null);
  const [source, setSource] = useState("");
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== "function") return undefined;
    const url = URL.createObjectURL(file);
    setSource(url);
    return () => {
      audio.current?.pause();
      URL.revokeObjectURL(url);
    };
  }, [file]);
  const Icon = playing ? Pause : Play;
  const label = tr(
    playing ? "Приостановить выбранный аудиофайл" : "Прослушать выбранный аудиофайл"
  );
  return (
    <>
      <IconButton
        variant="outline"
        label={label}
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

export function AddSongsModal({ review, onCancel, onConfirm, onUpdate }) {
  const item = review?.items?.[review.index];
  return (
    <Modal
      isOpen={Boolean(item)}
      onClose={onCancel}
      ariaLabel={tr("Подтверждение добавления песни")}
      titleProps={{
        icon: Music2,
        image: item?.coverUrl || undefined,
        eyebrow: item
          ? tr("Песня {0} из {1}", { 0: review.index + 1, 1: review.items.length })
          : "",
        title: tr("Проверьте данные песни"),
        description: tr("Обработка начнётся только после подтверждения всех файлов")
      }}
    >
      {item && (
        <Box
          as="form"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm();
          }}
          sx={{ padding: "var(--space-5)" }}
        >
          <Stack gap={1}>
            <Stack direction="row" gap={1}>
              <TextField
                label={tr("Исполнитель")}
                value={item.artist}
                onChange={(artist) => onUpdate({ artist })}
              />
              <TextField
                label={tr("Название песни")}
                required
                value={item.title}
                onChange={(title) => onUpdate({ title })}
              />
            </Stack>
            <Select
              label={tr("Режим обработки")}
              value={item.processingMode}
              options={getProcessingModeOptions()}
              hint={tr("Авто выбирает сбалансированный профиль для вашего железа")}
              onChange={(processingMode) => onUpdate({ processingMode })}
            />
            <Card sx={{ padding: "var(--space-3) var(--space-4)" }}>
              <Stack direction="row" align="center" gap={0.75}>
                <SelectedFilePreview file={item.file} />
                <Stack gap={0.15}>
                  <Typography variant="caption" tone="muted">
                    {tr("Выбранный аудиофайл")}
                  </Typography>
                  <Typography sx={{ fontWeight: 750, overflowWrap: "anywhere" }}>
                    {item.file.name}
                  </Typography>
                </Stack>
              </Stack>
            </Card>
            <Stack direction="row" justify="flex-end" gap={0.75}>
              <Button variant="ghost" type="button" onClick={onCancel}>
                {tr("Пропустить")}
              </Button>
              <Button type="submit" disabled={!item.title.trim()}>
                {tr("Подтвердить")}
              </Button>
            </Stack>
          </Stack>
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
      ? tr("Модель синхронизации недоступна. Проверьте установку AI-моделей и повторите обработку.")
      : normalized.includes("timestamp") || normalized.includes("interval")
        ? tr(
            "Не удалось построить корректные интервалы слов по вокалу. Проверьте текст и повторите обработку."
          )
        : tr("Повторите обработку. Если ошибка повторится, откройте журнал выполнения ниже.");
  return {
    type: separator > 0 ? raw.slice(0, separator).trim() : "ProcessingError",
    reason:
      (separator > 0 ? raw.slice(separator + 1).trim() : raw) || tr("Причина не передана backend"),
    hint
  };
}

const statusLabels = {
  done: "Готово",
  error: "Ошибка",
  cancelled: "Отменено",
  processing: "Обрабатывается",
  queued: "В очереди",
  cancelling: "Отменяется"
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
  const current = !status?.song_id || status.song_id === song?.id ? status : null;
  const state = current?.status ?? song?.status;
  const { coverUrl, hasCover, handleCoverError } = useSongCover(song?.id, state);
  if (!song) return null;
  const progress = getProcessingProgress(current, song);
  const active = isProcessingActive(state);
  const failed = state === "error";
  const cancelled = state === "cancelled";
  const failure = failed
    ? getProcessingFailureInfo(current?.error_message ?? song.error_message)
    : null;
  const queue = songs.some(({ id }) => id === song.id) ? songs : [song, ...songs];
  const index = queue.findIndex(({ id }) => id === song.id);
  const actions = [
    active && (
      <Button key="cancel" tone="danger" startIcon={<OctagonX />} onClick={onCancel}>
        {tr("Отменить")}
      </Button>
    ),
    state === "done" && (
      <Button key="library" variant="ghost" startIcon={<Library />} onClick={onClose}>
        {tr("В библиотеку")}
      </Button>
    ),
    state === "done" && (
      <Button key="open" startIcon={<Play />} onClick={() => onOpenKaraoke(song.id)}>
        {tr("Открыть")}
      </Button>
    )
  ].filter(Boolean);
  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabel={tr("Обработка песни {0}", { 0: song.title })}
      titleProps={{
        icon: CircleDot,
        image: hasCover ? coverUrl : undefined,
        onImageError: handleCoverError,
        eyebrow: tr("ОБРАБОТКА ПЕСНИ"),
        title: song.title,
        description: tr("Следите за этапами подготовки и управляйте обработкой песни."),
        actions
      }}
    >
      <Stack gap={1} sx={{ padding: "var(--space-5)" }}>
        {queue.length > 1 && (
          <Stack direction="row" align="center" justify="space-between" gap={1}>
            <IconButton
              label={tr("Предыдущая песня")}
              variant="outline"
              disabled={index <= 0}
              onClick={() => onSelectSong(queue[index - 1])}
            >
              <ChevronLeft />
            </IconButton>
            <Stack align="center" gap={0.1}>
              <Typography sx={{ fontWeight: 750 }}>
                {tr("Песня {0} из {1}", { 0: index + 1, 1: queue.length })}
              </Typography>
              <Typography variant="caption" tone="muted">
                {song.artist || tr("Исполнитель не указан")}
              </Typography>
            </Stack>
            <IconButton
              label={tr("Следующая песня")}
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
          {tr(statusLabels[state] || state || "Ожидание")}
        </Chip>
        {!failed && !cancelled && (
          <ProcessingSignal
            progress={state === "done" ? 100 : Math.max(active ? 1 : 0, progress)}
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
                <Typography sx={{ fontWeight: 800 }}>{tr("Обработка остановлена")}</Typography>
              </Stack>
              <Typography tone="danger">{failure.reason}</Typography>
              <GridInfo
                items={[
                  [tr("Тип ошибки"), failure.type],
                  [
                    tr("Этап"),
                    current?.progress_detail ??
                      current?.progress_step ??
                      song.progress_step ??
                      tr("Не указан")
                  ],
                  [tr("Выполнено"), `${Math.round(progress)}%`]
                ]}
              />
              <Typography variant="body2" tone="muted">
                {failure.hint}
              </Typography>
              <Button
                variant="outline"
                onClick={() => globalThis.electronAPI?.openApplicationLog?.()}
              >
                {tr("Открыть журнал выполнения")}
              </Button>
            </Stack>
          </Card>
        ) : (
          <Stack direction="row" justify="space-between" gap={1}>
            <Typography>
              {state === "done"
                ? tr("Песня готова к караоке")
                : cancelled
                  ? tr("Обработка отменена")
                  : (current?.progress_detail ??
                    current?.progress_step ??
                    tr("Подготавливаем обработку песни"))}
            </Typography>
            {active && (
              <Typography sx={{ fontWeight: 800 }}>
                {tr("Осталось:")} {formatEta(current?.eta_seconds)}
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
      ariaLabel={tr("Исполнения песни {0}", { 0: song.title })}
      titleProps={{
        icon: Music2,
        eyebrow: tr("ИСПОЛНЕНИЯ ПЕСНИ"),
        title: song.title,
        description: tr("Прослушивайте исполнения, запускайте анализ и управляйте записями.")
      }}
    >
      <Stack gap={0.75} sx={{ padding: "var(--space-5)" }}>
        {recordings.map((recording) => (
          <Card key={recording.id} sx={{ padding: "var(--space-3)" }}>
            <Stack direction="row" align="center" gap={0.75}>
              <Box sx={{ flex: 1 }}>
                <AudioPlayer
                  src={api.getPerformanceFileUrl(recording.id)}
                  initialDuration={recording.duration_sec}
                />
              </Box>
              <IconButton
                label={tr("Анализировать запись")}
                variant="outline"
                onClick={() => onAnalyze(recording)}
              >
                <BarChart3 />
              </IconButton>
              <IconButton
                label={tr("Удалить запись")}
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
            {tr("Для этой песни пока нет записанных исполнений.")}
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
