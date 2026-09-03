import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../api/client";
import { usePolling } from "../../../hooks/usePolling";
import { translateSaved as tr } from "../../../i18n/runtime";
import { POLLING_INTERVALS } from "../../../runtime-config";
import { getErrorMessage } from "../../../utils/errors";
import { setProcessingLoadActive } from "../../../utils/performance-profile";
import {
  getProcessingSongs,
  hasActiveSongProcessing,
  isProcessingActive,
  mergeSongProcessingStatus
} from "../utils";

export default function useLibraryProcessing(songsQuery, dialog) {
  const [song, setSong] = useState(null);
  const [trackedId, setTrackedId] = useState(null);

  const status = usePolling(
    () => (trackedId ? api.getStatus(trackedId) : Promise.resolve(null)),
    trackedId ? POLLING_INTERVALS.processing : 0,
    [trackedId],
    {
      queryKey: ["song-status", trackedId],
      shouldContinue: ({ status } = {}) => isProcessingActive(status),
      shouldRetryError: ({ status } = {}) => status !== 404
    }
  );

  const track = useCallback((song) => {
    setSong(song);
    setTrackedId(song?.id ?? null);
  }, []);

  const currentSongs = useMemo(
    () => mergeSongProcessingStatus(songsQuery.data, status.data),
    [songsQuery.data, status.data]
  );

  const songs = useMemo(() => getProcessingSongs(currentSongs), [currentSongs]);
  const selected = currentSongs.find(({ id }) => id === song?.id) ?? song;
  const active = hasActiveSongProcessing(currentSongs);

  useEffect(() => {
    setProcessingLoadActive(active);
    return () => setProcessingLoadActive(false);
  }, [active]);

  useEffect(() => {
    if (trackedId) return;

    const next = getProcessingSongs(songsQuery.data)[0];
    if (next) track(next);
  }, [songsQuery.data, trackedId, track]);

  useEffect(() => {
    if (status.error?.status === 404) {
      setTrackedId(null);
      return;
    }

    if (
      !trackedId ||
      status.data?.song_id !== trackedId ||
      isProcessingActive(status.data?.status)
    ) {
      return;
    }

    setSong((song) => (song?.id === trackedId ? { ...song, ...status.data } : song));

    let mounted = true;

    Promise.resolve()
      .then(songsQuery.refresh)
      .catch(() => {})
      .finally(() => mounted && setTrackedId(null));

    return () => {
      mounted = false;
    };
  }, [trackedId, status.data, status.error, songsQuery.refresh]);

  const cancel = useCallback(async () => {
    if (!song || !(await dialog.confirm(tr("library.cancelProcessingOfThisSong")))) return;
    try {
      await api.cancelProcessing(song.id);
      await songsQuery.refresh();
    } catch (error) {
      await dialog.alert(
        tr("library.failedToCancelProcessing", {
          0: getErrorMessage(error)
        })
      );
    }
  }, [song, dialog, songsQuery.refresh]);

  return {
    currentSongs,
    active,
    songs,
    song: selected,
    track,
    cancel,
    close: () => setSong(null),
    status: status.data?.song_id === selected?.id ? status.data : null
  };
}
