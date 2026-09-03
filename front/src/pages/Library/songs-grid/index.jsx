import { useDropzone } from "react-dropzone";
import { translateSaved as tr } from "../../../i18n/runtime";
import { Box, Card, Grid, Stack, Typography } from "../../../theme/ui";
import LibrarySongCard from "./card";

export const selectSongTransferStatus = (statuses, id) => {
  const all = statuses.filter((s) => s?.songId === id);
  return (
    all.find((s) => s.stage === "error") ||
    all
      .filter((s) => s.participantId && s.participantId !== "room")
      .sort((a, b) => a.percent - b.percent)[0] ||
    all.at(-1)
  );
};

export default function LibrarySongsGrid({ state, fileImport, processing, recordings }) {
  const {
    filteredSongs: songs,
    songsError: error,
    transferStatuses,
    canManageLibrary,
    openKaraoke,
    setSettingsSongId,
    songActions
  } = state;
  const statuses = [...(transferStatuses?.values?.() || [])];
  const { getRootProps, isDragActive } = useDropzone({
    accept: {
      "audio/*": [".mp3", ".wav", ".flac", ".m4a", ".ogg"],
      "application/octet-stream": [".kar", ".mid", ".kfn"]
    },
    disabled: fileImport.importing || !canManageLibrary,
    onDropAccepted: fileImport.importFile,
    multiple: true,
    noClick: true,
    noKeyboard: true
  });
  if (error || !songs.length)
    return (
      <Stack align="center" justify="center" sx={{ minHeight: "30vw" }}>
        <Card
          variant="laser"
          sx={{ textAlign: "center" }}
          cardContent={{ style: { padding: "var(--space-16)" } }}
        >
          <Typography variant="h4" tone={error ? "danger" : "muted"} role={error && "alert"}>
            {error
              ? `${tr("library.failedToLoadList")} ${error.message || error}`
              : tr("library.thereAreNoSongsYetAddTheFirstOne")}
          </Typography>
        </Card>
      </Stack>
    );
  return (
    <Box
      {...getRootProps()}
      aria-label={tr("library.songDropZone")}
      data-drop-active={isDragActive || undefined}
    >
      <Grid columns={3} gap="var(--space-6)" align="start">
        {songs.map((song, cardIndex) => (
          <LibrarySongCard
            key={song.id}
            {...{ song, cardIndex, canManageLibrary }}
            transferStatus={selectSongTransferStatus(statuses, song.id)}
            onOpenKaraoke={openKaraoke}
            onOpenProcessing={processing.track}
            onOpenRecordings={recordings.setSong}
            onOpenSettings={setSettingsSongId}
            onDelete={songActions.deleteSong}
            onOpenFolder={songActions.openSongFolder}
            onProcess={songActions.processSong}
            onReprocess={songActions.reprocessSong}
          />
        ))}
      </Grid>
    </Box>
  );
}
