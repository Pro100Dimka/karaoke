import { useLocation } from "react-router-dom";
import { api } from "../../api/client";
import { usePolling } from "../../hooks/usePolling";
import { queryKeys } from "../../query-client";
import { POLLING_INTERVALS } from "../../runtime-config";
import useKaraokeResult from "./hooks/useKaraokeResult";
import useRoutedSong from "./hooks/useRoutedSong";
import KaraokeLoadState from "./karaoke-load-state";
import KaraokeSession from "./karaoke-session";

export default function Karaoke({ onOpenAppSettings }) {
  const { state = {} } = useLocation();
  const { data: songs, error: songsError } = usePolling(
    api.listSongs,
    POLLING_INTERVALS.settings,
    [],
    { queryKey: queryKeys.songs }
  );
  const songId = state.songId ?? null;
  const song = useRoutedSong(songs, songId);
  const resultState = useKaraokeResult(song);

  if (
    songsError ||
    !songs ||
    !song ||
    song.status !== "done" ||
    resultState.loading ||
    resultState.error ||
    !resultState.result
  ) {
    return (
      <KaraokeLoadState
        songs={songs}
        songsError={songsError}
        song={song}
        songId={songId}
        result={resultState.result}
        resultLoading={resultState.loading}
        resultError={resultState.error}
      />
    );
  }

  return (
    <KaraokeSession
      key={String(song.id)}
      song={song}
      lyricsSync={resultState.result.lyrics_sync}
      autoStartRequested={Boolean(state.autoPlay)}
      roomPrepared={Boolean(state.roomPrepared)}
      onOpenAppSettings={onOpenAppSettings}
    />
  );
}
