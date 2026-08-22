import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { translateSaved as tr } from "../../../i18n/runtime";
import { Box, Grid } from "../../../theme/ui";
import LibraryResults from "./results";
import LibrarySongCard from "./song-card";

function SongGrid({ songs, transferStatuses, ...handlers }) {
  if (songs.length > 45)
    return (
      <VirtualSongGrid songs={songs} transferStatuses={transferStatuses} handlers={handlers} />
    );
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

export default function LibrarySongsGrid({ state, fileImport, processing, recordings }) {
  return (
    <LibraryResults
      error={state.songsError}
      onFileChosen={fileImport.importFile}
      fileInputRef={state.fileInputRef}
      importing={fileImport.importing}
      canManageLibrary={state.canManageLibrary}
      songs={state.filteredSongs}
      errorText={`${tr("Не удалось загрузить список:")} ${state.songsError?.message || state.songsError || ""}`}
    >
      <SongGrid
        songs={state.filteredSongs}
        canManageLibrary={state.canManageLibrary}
        transferStatuses={state.transferStatuses}
        onOpenKaraoke={state.openKaraoke}
        onOpenProcessing={processing.track}
        onOpenRecordings={recordings.setSong}
        onOpenSettings={state.setSettingsSongId}
        onDelete={state.songActions.deleteSong}
        onOpenFolder={state.songActions.openSongFolder}
        onProcess={state.songActions.processSong}
        onReprocess={state.songActions.reprocessSong}
      />
    </LibraryResults>
  );
}
function VirtualSongGrid({ songs, transferStatuses, handlers }) {
  const host = useRef(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const rows = useMemo(
    () =>
      Array.from({ length: Math.ceil(songs.length / 3) }, (_, index) =>
        songs.slice(index * 3, index * 3 + 3)
      ),
    [songs]
  );
  useLayoutEffect(() => setScrollMargin(host.current?.offsetTop ?? 0), []);
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => 220,
    overscan: 2,
    scrollMargin
  });
  return (
    <Box ref={host} sx={{ position: "relative", blockSize: `${virtualizer.getTotalSize()}px` }}>
      {virtualizer.getVirtualItems().map((virtualRow) => (
        <Box
          ref={virtualizer.measureElement}
          data-index={virtualRow.index}
          key={virtualRow.key}
          sx={{
            position: "absolute",
            insetBlockStart: 0,
            insetInline: 0,
            transform: `translateY(${virtualRow.start - scrollMargin}px)`
          }}
        >
          <Grid columns={3} gap="var(--space-6)" align="start">
            {rows[virtualRow.index].map((song, index) => (
              <LibrarySongCard
                key={song.id}
                cardIndex={virtualRow.index * 3 + index}
                song={song}
                transferStatus={[...(transferStatuses?.values?.() || [])].find(
                  ({ songId }) => songId === song.id
                )}
                {...handlers}
              />
            ))}
          </Grid>
        </Box>
      ))}
    </Box>
  );
}
