import { useDropzone } from "react-dropzone";
import { translateSaved as tr } from "../../../i18n/runtime";
import { Box, Card, Grid, Stack, Typography } from "../../../theme/ui";
import LibrarySongCard from "./song-card";

export function selectSongTransferStatus(statuses, songId) {
  const matching = statuses.filter((status) => status?.songId === songId);
  const error = matching.find((status) => status.stage === "error");
  if (error) return error;

  // The host keeps a synthetic `room` status for the ready-participant count,
  // while every actual file transfer has its own participant status. During a
  // transfer the synthetic entry remains at 0 until the recipient is fully
  // ready, so choosing the first matching Map value made the card look frozen
  // even though the participant row showed real progress. Completed recipients
  // are removed from the Map, therefore the slowest remaining real transfer is
  // the useful room-wide progress to show on the song card.
  const participantStatuses = matching.filter(
    (status) => status.participantId && status.participantId !== "room"
  );
  if (participantStatuses.length)
    return participantStatuses.reduce((slowest, status) =>
      Number(status.percent) < Number(slowest.percent) ? status : slowest
    );
  return matching.at(-1);
}

export default function LibrarySongsGrid({ state: s, fileImport: f, processing, recordings }) {
  const { filteredSongs: songs, songsError: error, songActions: a } = s;
  const statuses = [...(s.transferStatuses?.values?.() || [])];
  const card = {
    canManageLibrary: s.canManageLibrary,
    onOpenKaraoke: s.openKaraoke,
    onOpenProcessing: processing.track,
    onOpenRecordings: recordings.setSong,
    onOpenSettings: s.setSettingsSongId,
    onDelete: a.deleteSong,
    onOpenFolder: a.openSongFolder,
    onProcess: a.processSong,
    onReprocess: a.reprocessSong
  };
  const drop = useDropzone({
    accept: {
      "audio/*": [".mp3", ".wav", ".flac", ".m4a", ".ogg"],
      "application/octet-stream": [".kar", ".mid", ".kfn"]
    },
    disabled: f.importing || !s.canManageLibrary,
    multiple: true,
    noClick: true,
    noKeyboard: true,
    onDropAccepted: f.importFile
  });
  if (!songs.length || error)
    return (
      <Stack align="center" justify="center" sx={{ minHeight: "30vw" }}>
        <Card
          variant="laser"
          sx={{ textAlign: "center" }}
          cardContent={{ style: { padding: "var(--space-16)" } }}
        >
          <Typography
            variant="h4"
            {...(error ? { role: "alert", tone: "danger" } : { tone: "muted" })}
          >
            {error
              ? `${tr("Не удалось загрузить список:")} ${error.message || error}`
              : tr("Пока нет ни одной песни — добавьте первую")}
          </Typography>
        </Card>
      </Stack>
    );
  return (
    <Box
      {...drop.getRootProps()}
      aria-label={tr("Зона добавления песен")}
      data-drop-active={drop.isDragActive || undefined}
    >
      <Grid columns={3} gap="var(--space-6)" align="start">
        {songs.map((song, cardIndex) => (
          <LibrarySongCard
            key={song.id}
            {...card}
            {...{ song, cardIndex }}
            transferStatus={selectSongTransferStatus(statuses, song.id)}
          />
        ))}
      </Grid>
    </Box>
  );
}
