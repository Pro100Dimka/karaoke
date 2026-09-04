import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../api/client";
import { usePolling } from "../../../hooks/usePolling";
import { translateSaved as tr } from "../../../i18n/runtime";
import { POLLING_INTERVALS } from "../../../runtime-config";
import { getErrorMessage } from "../../../utils/errors";
import { setProcessingLoadActive } from "../../../utils/performance-profile";
import { getProcessingSongs, isProcessingActive, mergeSongProcessingStatus, sameId } from "../utils";

export default function useLibraryProcessing({ data, refresh }, dialog) {
  const [song, setSong] = useState(null);
  const [trackedId, setTrackedId] = useState(null);
  const status = usePolling(
    () => (trackedId ? api.getStatus(trackedId) : Promise.resolve(null)),
    trackedId ? POLLING_INTERVALS.processing : 0,
    [trackedId],
    {
      queryKey: ["song-status", trackedId],
      shouldContinue: (value) => isProcessingActive(value?.status),
      shouldRetryError: (error) => error?.status !== 404
    }
  );

  const track = useCallback((song) => {
    setSong(song);
    setTrackedId(song?.id ?? null);
  }, []);

  const { currentSongs, songs } = useMemo(() => {
    const currentSongs = mergeSongProcessingStatus(data, status.data);
    return { currentSongs, songs: getProcessingSongs(currentSongs) };
  }, [data, status.data]);

  const selected = currentSongs.find(({ id }) => sameId(id, song?.id)) ?? song;
  const active = !!songs.length;

  useEffect(() => {
    setProcessingLoadActive(active);
    return () => setProcessingLoadActive(false);
  }, [active]);

  useEffect(() => {
    if (!trackedId && songs[0]) track(songs[0]);
  }, [songs, trackedId, track]);

  useEffect(() => {
    if (!trackedId) return;
    const missing = status.error?.status === 404;
    const finished = sameId(status.data?.song_id, trackedId) && !isProcessingActive(status.data?.status);
    if (!missing && !finished) return;

    setSong((song) =>
      sameId(song?.id, trackedId) ? (missing ? null : { ...song, ...status.data }) : song
    );

    let mounted = true;
    Promise.resolve()
      .then(refresh)
      .catch(() => {})
      .finally(() => mounted && setTrackedId(null));
    return () => {
      mounted = false;
    };
  }, [trackedId, status.data, status.error, refresh]);

  const cancel = useCallback(async () => {
    if (!song || !(await dialog.confirm(tr("library.cancelProcessingOfThisSong")))) return;
    try {
      await api.cancelProcessing(song.id);
    } catch (error) {
      return dialog.alert(tr("library.failedToCancelProcessing", { 0: getErrorMessage(error) }));
    }
    await refresh().catch(() => {});
  }, [song, dialog, refresh]);

  return {
    currentSongs,
    active,
    songs,
    song: selected,
    track,
    cancel,
    close: () => setSong(null),
    status: sameId(status.data?.song_id, selected?.id) ? status.data : null
  };
}
