import { Mic } from "lucide-react";
import useSongCover from "../../../../hooks/useSongCover";
import { translateSaved as t } from "../../../../i18n/runtime";
import { Box, Stack, Typography } from "../../../../theme/ui";
import { formatTime } from "../../utils/format";
import WaveformTimeline from "../waveform-timeline";

export default function SongStrip({ song, currentTime, duration, onSeek, disablelabel }) {
  const { coverUrl, hasCover, handleCoverError } = useSongCover(
    song?.id,
    `${song?.updated_at ?? ""}:${song?.status ?? ""}`
  );
  return (
    <Stack
      direction="row"
      align="center"
      gap="var(--space-3)"
      sx={{
        padding: "var(--space-1) var(--space-3)",
        borderBlockEnd: "1px solid color-mix(in srgb, var(--color-primary) 35%, transparent)",
        background: "color-mix(in srgb, var(--color-bg-deep) 48%, transparent)"
      }}
    >
      {!disablelabel && (
        <>
          <Box
            aria-hidden="true"
            sx={{
              position: "relative",
              aspectRatio: 1,
              padding: "var(--space-4)",
              flex: "none",
              display: "grid",
              placeItems: "center",
              overflow: "hidden",
              borderRadius: "var(--shape-md)",
              color: "var(--color-primary)",
              background: "var(--ui-gradient-surface)"
            }}
          >
            {hasCover ? (
              <Box
                as="img"
                src={coverUrl}
                alt=""
                decoding="async"
                onError={handleCoverError}
                sx={{
                  position: "absolute",
                  inset: 0,
                  inlineSize: "100%",
                  blockSize: "100%",
                  objectFit: "cover"
                }}
              />
            ) : (
              <Mic />
            )}
          </Box>
          <Stack gap="var(--space-1)" sx={{ flex: "0 1 12rem", minInlineSize: 0 }}>
            <Typography as="strong" variant="body2" noWrap>
              {song.title}
            </Typography>
            <Typography variant="caption" tone="muted" noWrap>
              {song.artist || song.performer || t("karaoke.karaoke")}
            </Typography>
          </Stack>
        </>
      )}
      <Typography variant="caption">{formatTime(currentTime)}</Typography>
      <WaveformTimeline
        songId={song.id}
        value={currentTime}
        duration={duration}
        onChange={onSeek}
      />
      <Typography variant="caption">{formatTime(duration)}</Typography>
    </Stack>
  );
}
