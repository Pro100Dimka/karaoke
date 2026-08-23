import {
  AudioWaveform,
  FolderOpen,
  Headphones,
  Music2,
  Play,
  RotateCcw,
  Settings2,
  Trash2
} from "lucide-react";
import { translateSaved as tr } from "../../i18n/runtime";
import { Box, ProcessingSignal, Stack } from "../../theme/ui";
import useSongCover from "./hooks/useSongCover";

const EQUALIZER_BARS = Array.from({ length: 16 }, (_, index) => ({
  level: 0.28 + ((index * 37 + 19) % 61) / 100,
  speed: 720 + ((index * 113 + 47) % 620)
}));

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
  activate,
  song
}) {
  return [
    ...(isReady
      ? [
          [Play, tr("Воспроизвести"), "contained", activate],
          [Headphones, tr("Прослушать записи"), "contained", () => onOpenRecordings(song)]
        ]
      : (canManageLibrary && [
          [AudioWaveform, tr("Обработать песню"), "contained", () => onProcess(song), isWorking]
        ]) ||
        []),
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
