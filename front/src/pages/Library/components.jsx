import {
  AudioWaveform,
  FolderOpen,
  Headphones,
  Mic2,
  Music2,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  UsersRound
} from "lucide-react";
import { memo } from "react";
import { translateSaved as tr } from "../../i18n/runtime";
import {
  Box,
  Button,
  Card,
  Chip,
  Grid,
  IconButton,
  InputBase,
  Progress,
  Stack,
  Typography
} from "../../theme/ui";
import AnimatedLibraryBackdrop from "./animated-backdrop";
import useSongCover from "./hooks/useSongCover";
import { formatSongKey, getSongCardState } from "./utils";

const statusTone = { done: "success", error: "danger", processing: "primary", queued: "default" };
const statusText = {
  done: "Готово",
  error: "Ошибка",
  processing: "Обрабатывается",
  queued: "В очереди",
  cancelling: "Отменяется",
  cancelled: "Отменено",
  pending: "Ожидает обработки"
};
const STAT_CARDS = [
  [Music2, "songCount", "всего песен"],
  [Mic2, "readyCount", "готово к караоке"]
];
const EQUALIZER_BARS = Array.from({ length: 16 }, (_, index) => ({
  level: 0.28 + ((index * 37 + 19) % 61) / 100,
  speed: 720 + ((index * 113 + 47) % 620)
}));

export function LibraryBackdrop() {
  return (
    <Box
      aria-hidden="true"
      sx={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: -1,
        overflow: "hidden",
        background: `
          radial-gradient(circle at 15% 20%, color-mix(in srgb, var(--ui-primary) 24%, transparent), transparent 34%),
          radial-gradient(circle at 85% 12%, color-mix(in srgb, var(--ui-secondary) 18%, transparent), transparent 32%),
          linear-gradient(180deg, color-mix(in srgb, var(--color-surface) 42%, transparent), var(--color-bg))`
      }}
    >
      <AnimatedLibraryBackdrop />
    </Box>
  );
}

export function LibraryActions({
  canManageLibrary,
  fileInputRef,
  importing,
  onAdd,
  onFileChosen,
  onOpenRoom,
  roomActive,
  query,
  setQuery
}) {
  return (
    <Grid columns={4} gap="var(--space-4)" align="center">
      <Card
        variant="laser"
        tilt={false}
        cardContent={{
          style: {
            display: "flex",
            alignItems: "center",
            padding: "var(--space-4) var(--space-5)",
            gap: "var(--space-4)"
          }
        }}
      >
        <Search aria-hidden="true" />
        <InputBase
          component="input"
          aria-label={tr("Поиск")}
          placeholder={tr("Поиск...")}
          value={query}
          onChange={(event) => setQuery(event.target.value, event)}
          sx={{
            flex: 1,
            minWidth: 0,
            border: 0,
            outline: 0,
            background: "transparent",
            color: "var(--ui-text)",
            font: "inherit"
          }}
        />
      </Card>
      <Stack
        direction="row"
        justify="flex-end"
        wrap
        gap="var(--space-2)"
        sx={{ gridColumn: "span 3" }}
      >
        {!roomActive && (
          <Button size="lg" variant="outline" startIcon={<UsersRound />} onClick={onOpenRoom}>
            {tr("Петь вместе")}
          </Button>
        )}
        {canManageLibrary && (
          <Button
            size="lg"
            startIcon={<Plus />}
            disabled={importing}
            onClick={onAdd}
            sx={{ boxShadow: "var(--shadow-neon-primary)" }}
          >
            {tr("Добавить песню")}
          </Button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg"
          onChange={onFileChosen}
          disabled={importing}
          style={{
            position: "fixed",
            display: "none",
            opacity: 0,
            pointerEvents: "none"
          }}
        />
      </Stack>
    </Grid>
  );
}

export function LibraryHero({ songCount, readyCount, ...actions }) {
  const values = { songCount, readyCount };
  return (
    <Stack
      gap="var(--space-12)"
      sx={{ paddingBlock: "var(--space-16)" }}
      justify="center"
      align="center"
    >
      <Stack direction="row" justify="space-between" align="center">
        <Stack direction="row" align="center" gap="var(--space-5)">
          <Box
            aria-hidden="true"
            sx={{
              aspectRatio: 1,
              flex: "none",
              padding: "var(--space-12)",
              background: "var(--app-icon-image) center / contain no-repeat",
              filter:
                "drop-shadow(0 0 var(--space-5) color-mix(in srgb, var(--ui-primary) 28%, transparent))"
            }}
          />
          <Stack gap="var(--space-1)" sx={{ minWidth: 0 }}>
            <Typography variant="caption" tone="muted">
              {tr("Ваша музыкальная коллекция")}
            </Typography>
            <Typography variant="h2">{tr("Библиотека песен")}</Typography>
            <Typography variant="body1" tone="muted">
              {tr("Добавляйте треки, управляйте обработкой и открывайте их в караоке.")}
            </Typography>
          </Stack>
        </Stack>
        <Stack direction="row" gap="1rem" sx={{ width: "40%" }}>
          {STAT_CARDS.map(([Icon, key, label]) => (
            <Card
              key={key}
              variant="laser"
              tilt={false}
              sx={{ flex: 1, width: "100%" }}
              cardContent={{
                style: {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-start",
                  gap: "var(--space-5)",
                  padding: "var(--space-6) var(--space-6)"
                }
              }}
            >
              <Box
                aria-hidden="true"
                sx={{
                  position: "relative",
                  color: "var(--ui-primary)",
                  padding: "var(--space-3)"
                }}
              >
                <Icon />
                <Sparkles style={{ position: "absolute", inset: "auto auto 70% 70%" }} />
              </Box>
              <Stack gap="var(--space-1)">
                <Typography variant="h3">{values[key]}</Typography>
                <Typography variant="body2" tone="muted">
                  {tr(label)}
                </Typography>
              </Stack>
            </Card>
          ))}
        </Stack>
      </Stack>
      <LibraryActions {...actions} />
    </Stack>
  );
}

function EqualizerArtwork({ cardIndex }) {
  return (
    <Box sx={{ position: "absolute", inset: 0, background: "var(--ui-gradient-surface)" }}>
      <Music2
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: "var(--space-5) auto auto 46%",
          color: "var(--ui-primary)",
          filter: "drop-shadow(0 0 var(--space-2) currentColor)"
        }}
      />
      <Stack
        direction="row"
        align="stretch"
        gap="var(--space-1)"
        sx={{ position: "absolute", inset: "34% 10% 10%" }}
      >
        {EQUALIZER_BARS.map(({ level, speed }, index) => (
          <Box
            as="span"
            key={index}
            sx={{
              flex: 1,
              alignSelf: "stretch",
              transformOrigin: "bottom",
              borderRadius: "var(--shape-round)",
              background: "linear-gradient(var(--ui-text), var(--ui-primary))"
            }}
            style={{
              "--bar-level": level,
              animation: `library-card-wave ${speed + ((cardIndex * 29) % 240)}ms ease-in-out ${(cardIndex + index) * -85}ms infinite alternate`
            }}
          />
        ))}
      </Stack>
    </Box>
  );
}

export function SongCoverArt({ cardIndex = 0, children, song, sx }) {
  const version = `${song?.updated_at ?? ""}:${song?.status ?? ""}:${song?.__roomLocal ?? ""}`;
  const { coverUrl, hasCover, handleCoverError } = useSongCover(song?.id, version);
  return (
    <Box
      aria-hidden="true"
      sx={{
        position: "relative",
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        aspectRatio: 1,
        borderRadius: "var(--shape-md)",
        color: "var(--ui-primary)",
        background: "var(--ui-gradient-surface)",
        ...sx
      }}
    >
      {hasCover ? (
        <Box
          as="img"
          src={coverUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={handleCoverError}
          sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <EqualizerArtwork cardIndex={cardIndex} />
      )}
      {children}
    </Box>
  );
}

export const ProcessingSignal = ({ progress = 0, compact = false }) => {
  const value = Math.min(100, Math.max(0, Number(progress) || 0));
  return (
    <Stack direction="row" align="center" gap="var(--space-3)">
      <Progress
        value={value}
        size={compact ? "sm" : "md"}
        aria-label={tr("Обработка: {0}%", { 0: Math.round(value) })}
      />
      <Typography
        variant={compact ? "caption" : "body2"}
        sx={{ minInlineSize: "max-content", textAlign: "right" }}
      >
        {Math.round(value)}%
      </Typography>
    </Stack>
  );
};

export function getSongActions({
  canManageLibrary,
  isReady,
  isWorking,
  onDelete,
  onOpenFolder,
  onOpenRecordings,
  onOpenSettings,
  onProcess,
  onReprocess,
  song
}) {
  return [
    isReady
      ? [Headphones, tr("Прослушать записи"), "outline", () => onOpenRecordings(song)]
      : canManageLibrary && [
          AudioWaveform,
          tr("Обработать песню"),
          "outline",
          () => onProcess(song),
          isWorking
        ],
    canManageLibrary && [
      Settings2,
      tr("Настройки песни"),
      "outline",
      () => onOpenSettings(song.id)
    ],
    canManageLibrary && [FolderOpen, tr("Открыть папку"), "outline", () => onOpenFolder(song)],
    canManageLibrary &&
      isReady && [RotateCcw, tr("Переобработать мелодию"), "outline", () => onReprocess(song)],
    canManageLibrary && [Trash2, tr("Удалить песню"), "danger", () => onDelete(song)]
  ].filter(Boolean);
}

export const LibrarySongCard = memo(
  ({ cardIndex = 0, song, transferStatus, onOpenKaraoke, onOpenProcessing, ...handlers }) => {
    const { status, isReady, isWorking } = getSongCardState(song);
    const metadata = [
      formatSongKey(song.key_override),
      song.tempo_override && `${song.tempo_override} BPM`,
      song.difficulty_override
    ]
      .filter(Boolean)
      .join(" · ");
    const activate = () => isReady && onOpenKaraoke(song);
    return (
      <Card
        variant="laser"
        tilt={false}
        interactive={isReady}
        role={isReady ? "button" : undefined}
        tabIndex={isReady ? 0 : undefined}
        aria-label={isReady ? tr("Открыть {0} в караоке", { 0: song.title }) : undefined}
        onClick={(event) => !event.target.closest?.("button, a, input") && activate()}
        onKeyDown={(event) => {
          if (
            event.target === event.currentTarget &&
            ["Enter", " "].includes(event.key) &&
            isReady
          ) {
            event.preventDefault();
            activate();
          }
        }}
        sx={{ contentVisibility: "auto" }}
        style={{ "--card-sheen": "transparent", "--card-sheen-soft": "transparent" }}
        cardPanel={{
          style: {
            background: `
              radial-gradient(ellipse at 28% 14%, color-mix(in srgb, var(--ui-primary-hover) 8%, transparent), transparent 42%),
              linear-gradient(108deg,
                color-mix(in srgb, var(--ui-bg-deep) 88%, transparent),
                color-mix(in srgb, var(--ui-surface) 92%, transparent) 58%,
                color-mix(in srgb, var(--ui-bg-deep) 94%, transparent))`
          }
        }}
      >
        <Stack direction="row">
          <Stack sx={{ flex: 1 }}>
            <SongCoverArt
              cardIndex={cardIndex}
              song={song}
              sx={{ borderRadius: "var(--shape-lg)" }}
            />
          </Stack>
          <Stack
            gap="var(--space-2)"
            justify="space-between"
            sx={{ flex: 3.5, padding: "var(--space-4)" }}
          >
            <Stack direction="row" justify="space-between" align="start" gap="var(--space-3)">
              <Stack gap="var(--space-1)" sx={{ minWidth: 0 }}>
                <Typography as="h3" variant="body1">
                  <strong>{song.title}</strong>
                </Typography>
                <Typography variant="body2" tone="muted">
                  {song.artist || tr("Исполнитель не указан")}
                </Typography>
              </Stack>
              <Chip tone={statusTone[status] ?? "default"}>{tr(statusText[status] ?? status)}</Chip>
            </Stack>
            {(isWorking || transferStatus) && (
              <Button
                variant="ghost"
                onClick={isWorking ? () => onOpenProcessing(song) : undefined}
              >
                <ProcessingSignal
                  progress={transferStatus?.percent ?? song.progress_percent}
                  compact
                />
              </Button>
            )}
            <Stack direction="row" align="center" justify="space-between" wrap gap="var(--space-3)">
              <Typography variant="caption" tone="muted">
                {metadata}
              </Typography>
              <Stack
                direction="row"
                justify="flex-end"
                align="center"
                gap="var(--space-2)"
                sx={{ width: "auto" }}
              >
                {getSongActions({ ...handlers, isReady, isWorking, song }).map(
                  ([Icon, label, variant, onClick, disabled]) => (
                    <IconButton
                      key={label}
                      icon={Icon}
                      variant={variant}
                      size="sm"
                      label={label}
                      title={label}
                      disabled={disabled}
                      onClick={onClick}
                    />
                  )
                )}
              </Stack>
            </Stack>
          </Stack>
        </Stack>
      </Card>
    );
  }
);

export function LibraryResults({ error, songs, children, errorText }) {
  if (error)
    return (
      <Typography role="alert" tone="danger">
        {errorText}
      </Typography>
    );
  if (!songs.length)
    return (
      <Card sx={{ padding: "var(--space-8)", textAlign: "center" }}>
        <Typography tone="muted">{tr("Пока нет ни одной песни — добавьте первую")}</Typography>
      </Card>
    );
  return children;
}

export function SongGrid({ songs, transferStatuses, ...handlers }) {
  return (
    <Grid columns={3} gap="var(--space-6)" align="start">
      {songs.map((song, cardIndex) => (
        <LibrarySongCard
          key={song.id}
          cardIndex={cardIndex}
          song={song}
          transferStatus={[...(transferStatuses?.values?.() || [])].find(
            ({ songId }) => songId === song.id
          )}
          {...handlers}
        />
      ))}
    </Grid>
  );
}
