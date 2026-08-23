import {
  AudioWaveform,
  FolderOpen,
  Headphones,
  Music2,
  RotateCcw,
  Settings2,
  Trash2
} from "lucide-react";
import { translateSaved as tr } from "../../i18n/runtime";
import { Box, ProcessingSignal, Stack } from "../../theme/ui";
import AnimatedLibraryBackdrop from "./animated-backdrop";
import useSongCover from "./hooks/useSongCover";

const statusTone = { done: "success", error: "danger", processing: "primary", queued: "default" };
const statusText = {
  done: tr("Готово"),
  error: tr("Ошибка"),
  processing: tr("Обрабатывается"),
  queued: tr("В очереди"),
  cancelling: tr("Отменяется"),
  cancelled: tr("Отменено"),
  pending: tr("Ожидает обработки")
};

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
        zIndex: 0,
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

export function SongCoverArt({ cardIndex = 0, children, song, sx }) {
  const version = `${song?.updated_at ?? ""}:${song?.status ?? ""}:${song?.__roomLocal ?? ""}`;
  const { coverUrl, hasCover, handleCoverError } = useSongCover(song?.id, version);
  return (
    <Stack align="center" justify="center" sx={{ height: "100%" }}>
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
        <>
          <Music2
            aria-hidden="true"
            style={{
              flex: 1.5,
              color: "var(--ui-primary)",
              filter: "drop-shadow(0 0 var(--space-2) currentColor)"
            }}
          />
          <Stack
            direction="row"
            align="stretch"
            gap="var(--space-1)"
            sx={{ flex: 1, overflow: "hidden" }}
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
        </>
      )}
      {children}
    </Stack>
  );
}

export { ProcessingSignal };

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
      ? [Headphones, tr("Прослушать записи"), "contained", () => onOpenRecordings(song)]
      : canManageLibrary && [
          AudioWaveform,
          tr("Обработать песню"),
          "contained",
          () => onProcess(song),
          isWorking
        ],
    canManageLibrary && [
      Settings2,
      tr("Настройки песни"),
      "contained",
      () => onOpenSettings(song.id)
    ],
    canManageLibrary && [FolderOpen, tr("Открыть папку"), "contained", () => onOpenFolder(song)],
    canManageLibrary &&
      isReady && [RotateCcw, tr("Переобработать мелодию"), "contained", () => onReprocess(song)],
    canManageLibrary && [Trash2, tr("Удалить песню"), "danger", () => onDelete(song)]
  ].filter(Boolean);
}
