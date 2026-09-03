import { AlertCircle, LoaderCircle, Music2 } from "lucide-react";
import { translateSaved as t } from "../../i18n/runtime";
import { Card, Stack, Typography } from "../../theme/ui";

const STATES = [
  [
    (state) => state.songsError,
    "danger",
    AlertCircle,
    (state) =>
      `${t("karaoke.failedToLoadLibrary")} ${state.songsError?.message || t("karaoke.connectionError")}.`
  ],
  [(state) => !state.songs, "muted", LoaderCircle, () => t("karaoke.loadingTheSong")],
  [
    (state) => !state.song,
    "muted",
    Music2,
    (state) =>
      state.songId
        ? t("karaoke.theSelectedSongWasNotFoundReturnToThe")
        : t("karaoke.thereIsNoReadySongToPlayFirstProcess")
  ],
  [
    (state) => state.song?.status !== "done",
    "muted",
    Music2,
    (state) =>
      `«${state.song.title}» ${t("karaoke.hasNotBeenProcessedYetStatus")} ${state.song.status}.`
  ],
  [(state) => state.resultLoading, "muted", LoaderCircle, () => t("karaoke.loadingKaraokeData")],
  [
    (state) => state.resultError || !state.result,
    "danger",
    AlertCircle,
    (state) =>
      `${t("karaoke.failedToLoadKaraokeData")} ${state.resultError?.message || t("karaoke.noProcessingResult")}.`
  ]
];

export default function KaraokeLoadState(props) {
  const [, tone, Icon, message] = STATES.find(([matches]) => matches(props)) || [];
  if (!Icon) return null;
  return (
    <Stack
      align="center"
      justify="center"
      sx={{ position: "fixed", inset: 0, padding: "var(--space-6)" }}
    >
      <Card variant="laser" tilt={false} cardContent={{ style: { padding: "var(--space-8)" } }}>
        <Stack align="center" gap="var(--space-4)">
          <Icon aria-hidden="true" />
          <Typography role={tone === "danger" ? "alert" : "status"} tone={tone} align="center">
            {message(props)}
          </Typography>
        </Stack>
      </Card>
    </Stack>
  );
}
