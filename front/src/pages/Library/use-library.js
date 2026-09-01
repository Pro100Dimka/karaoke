import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { useAppDialog } from "../../contexts/AppDialog";
import { useOnlineRoom } from "../../contexts/OnlineRoomContext";
import useAppSettings from "../../hooks/useAppSettings";
import { usePolling } from "../../hooks/usePolling";
import { getOnlineNameMessage } from "../../hooks/useRequireOnlineName";
import { translateSaved as tr } from "../../i18n/runtime";
import { queryKeys } from "../../query-client";
import { POLLING_INTERVALS } from "../../runtime-config";
import { getErrorMessage } from "../../utils/errors";
import { setProcessingLoadActive } from "../../utils/performance-profile";
import { setGlobalRouteBlackout } from "../../utils/route-blackout";
import useLibraryFileImport from "./hooks/useFileImport";
import useLibraryRoomSync from "./hooks/useRoomSync";
import useLibrarySongActions from "./hooks/useSongActions";
import {
  countReadySongs,
  arrangeSongs,
  defaultLibraryFilters,
  getLibraryFilterOptions,
  getLocalVisibleSongs,
  getProcessingSongs,
  hasActiveSongProcessing,
  isProcessingActive,
  mergeSongProcessingStatus,
  resolveVisibleSongs
} from "./utils";

const closeAnalysisState = { analysisRecordingId: null, analysisRecordings: [] };

export default function useLibrary() {
  const location = useLocation();
  const navigate = useNavigate();
  const dialog = useAppDialog();
  const room = useOnlineRoom();
  const app = useAppSettings();
  const returning = Boolean(location.state?.fromKaraokeFade);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(defaultLibraryFilters);
  const [recordingsSong, setRecordingsSong] = useState(null);
  const [processingSong, setProcessingSong] = useState(null);
  const [settingsSongId, setSettingsSongId] = useState(null);
  const [trackedSongId, setTrackedSongId] = useState(null);
  const [analysis, setAnalysis] = useState({
    analysisRecordingId: location.state?.analysisRecordingId || null,
    analysisRecordings: []
  });
  const [hiddenSongIds, setHiddenSongIds] = useState(new Set());
  const [onlineRoomOpen, setOnlineRoomOpen] = useState(false);
  const [transitioning, setTransitioning] = useState(returning);
  const transition = useRef(returning);
  const remoteStatuses = useRef(new Map());
  const syncQueue = useRef(Promise.resolve());
  const fileInputRef = useRef(null);
  const songsQuery = usePolling(api.listSongs, 0, [], { queryKey: queryKeys.songs });
  const recordingsQuery = usePolling(
    () => (recordingsSong ? api.listRecordingsForSong(recordingsSong.id) : Promise.resolve([])),
    0,
    [recordingsSong?.id],
    { queryKey: ["recordings", recordingsSong?.id ?? null] }
  );
  const statusQuery = usePolling(
    () => (trackedSongId ? api.getStatus(trackedSongId) : Promise.resolve(null)),
    trackedSongId ? POLLING_INTERVALS.processing : 0,
    [trackedSongId],
    {
      queryKey: ["song-status", trackedSongId ?? null],
      shouldContinue: (status) => isProcessingActive(status?.status),
      shouldRetryError: (error) => error?.status !== 404
    }
  );

  const track = useCallback((song) => {
    setProcessingSong(song);
    setTrackedSongId(song?.id || null);
  }, []);
  const closeProcessing = useCallback(() => setProcessingSong(null), []);
  const closeAnalysis = useCallback(() => setAnalysis(closeAnalysisState), []);

  useEffect(() => {
    if (location.state?.analysisRecordingId) {
      setAnalysis((current) => ({
        ...current,
        analysisRecordingId: location.state.analysisRecordingId
      }));
    }
  }, [location.state?.analysisRecordingId]);
  useEffect(() => {
    if (!returning) return undefined;
    const timer = setTimeout(() => {
      transition.current = false;
      setTransitioning(false);
      setGlobalRouteBlackout(false);
    }, 120);
    return () => clearTimeout(timer);
  }, [returning]);
  useEffect(() => {
    if (statusQuery.error?.status === 404) setTrackedSongId(null);
  }, [statusQuery.error]);
  useEffect(() => {
    if (trackedSongId || !hasActiveSongProcessing(songsQuery.data)) return;
    track(getProcessingSongs(songsQuery.data)[0]);
  }, [songsQuery.data, track, trackedSongId]);
  useEffect(() => {
    const status = statusQuery.data;
    if (!trackedSongId || status?.song_id !== trackedSongId || isProcessingActive(status?.status))
      return;
    setProcessingSong((song) => (song?.id === trackedSongId ? { ...song, ...status } : song));
    let active = true;
    Promise.resolve(songsQuery.refresh()).finally(() => active && setTrackedSongId(null));
    return () => {
      active = false;
    };
  }, [songsQuery.refresh, statusQuery.data, trackedSongId]);

  const fileImport = useLibraryFileImport({
    fileInputRef,
    notify: dialog.alert,
    onStarted: (song) => {
      track(song);
      songsQuery.refresh();
    }
  });
  const songActions = useLibrarySongActions({
    confirmDialog: dialog.confirm,
    notify: dialog.alert,
    onChanged: songsQuery.refresh,
    processingSongId: processingSong?.id,
    recordingsSongId: recordingsSong?.id,
    setHiddenSongIds,
    setProcessingSong: track,
    setRecordingsSong
  });

  // These are recomputed from scratch (sorting, filtering, merging) rather
  // than cheap field reads, and this hook re-renders on every unrelated poll
  // tick (recordings, processing status, room presence) -- without memoizing
  // them, every one of those ticks redid the work AND hands SongsGrid/
  // LibraryHero a brand-new array/object identity even when the songs
  // themselves haven't changed.
  const currentSongs = useMemo(
    () => mergeSongProcessingStatus(songsQuery.data, statusQuery.data),
    [songsQuery.data, statusQuery.data]
  );
  const processingSongs = useMemo(() => getProcessingSongs(currentSongs), [currentSongs]);
  const selectedProcessingSong = useMemo(
    () => currentSongs.find(({ id }) => id === processingSong?.id) ?? processingSong,
    [currentSongs, processingSong]
  );
  const processingActive = hasActiveSongProcessing(currentSongs);
  useEffect(() => {
    setProcessingLoadActive(processingActive);
    return () => setProcessingLoadActive(false);
  }, [processingActive]);
  const localSongs = useMemo(
    () => getLocalVisibleSongs(currentSongs, hiddenSongIds),
    [currentSongs, hiddenSongIds]
  );
  const visibleSongs = useMemo(
    () =>
      resolveVisibleSongs({
        localSongs,
        room: room?.room,
        roomSongs: room?.roomUi?.songs,
        roomSongsByParticipant: room?.roomUi?.songsByParticipant
      }),
    [localSongs, room?.room, room?.roomUi?.songs, room?.roomUi?.songsByParticipant]
  );

  useEffect(() => {
    if (!room?.room) {
      remoteStatuses.current.clear();
      return;
    }
    const localIds = new Set(localSongs.map(({ id }) => id));
    const next = new Map();
    visibleSongs.forEach((song) => {
      if (!song?.id || song.__roomOwnerId === room.room.selfId) return;
      const previous = remoteStatuses.current.get(song.id);
      next.set(song.id, song.status);
      if (
        isProcessingActive(previous) &&
        song.status === "done" &&
        !localIds.has(song.id) &&
        song.__roomRevision
      ) {
        syncQueue.current = syncQueue.current
          .catch(() => {})
          .then(() => room.requestSongSync(song.id, song.__roomOwnerId))
          .then(songsQuery.refresh)
          .catch(() => {});
      }
    });
    remoteStatuses.current = next;
  }, [localSongs, room, songsQuery.refresh, visibleSongs]);

  useLibraryRoomSync({
    localSongs,
    query,
    filters,
    room: room?.room,
    roomEventId: room?.roomUi?.__eventId,
    roomQuery: room?.roomUi?.query,
    roomFilters: room?.roomUi?.filters,
    participantCount: room?.participants?.length,
    setQuery,
    setFilters,
    syncUi: room.syncUi
  });

  const openRoom = async () => {
    let settings;
    try {
      settings = await app.reloadSettings();
    } catch (error) {
      await dialog.alert(
        tr("library.failedToCheckOnlineModeSettings", {
          0: getErrorMessage(error)
        })
      );
      return;
    }
    if (!String(settings?.online_name ?? "").trim()) return dialog.alert(getOnlineNameMessage());
    setOnlineRoomOpen(true);
  };

  const openKaraoke = useCallback(
    async (song) => {
      if (transition.current) return;
      transition.current = true;
      try {
        if (room?.room && !room.room.host) {
          await room.openKaraoke(song.id, {
            ownerId: song.__roomOwnerId || room.room.selfId,
            revision: song.__roomRevision
          });
          transition.current = false;
          return;
        }
        let localSongId = song.id;
        if (room?.room && !localSongs.some(({ id }) => id === localSongId)) {
          const match = song.__roomRevision
            ? await api.resolveSongRevision(song.__roomRevision).catch(() => null)
            : null;
          if (match?.song_id) {
            localSongId = match.song_id;
          } else {
            if (!(await room.requestSongSync(song.id, song.__roomOwnerId, { roomWide: true })))
              throw new Error(tr("library.couldNotReceiveSongFromParticipant"));
            await songsQuery.refresh();
            if (!room.room.host) {
              transition.current = false;
              return;
            }
          }
        }
        if (room?.room && !(await room.openKaraoke(localSongId))) {
          transition.current = false;
          return;
        }
        setGlobalRouteBlackout(true);
        setTransitioning(true);
        await new Promise((resolve) => setTimeout(resolve, 920));
        navigate("/karaoke", { state: { songId: localSongId, autoPlay: true } });
      } catch (error) {
        transition.current = false;
        setTransitioning(false);
        setGlobalRouteBlackout(false);
        await dialog.alert(tr("library.failedToOpenSong", { 0: getErrorMessage(error) }));
      }
    },
    [dialog.alert, localSongs, navigate, room, songsQuery.refresh]
  );

  const handledKaraokeRequest = useRef(null);
  useEffect(() => {
    const command = room?.roomCommand;
    if (
      !room?.room?.host ||
      command?.type !== "karaoke-request" ||
      !command.__eventId ||
      handledKaraokeRequest.current === command.__eventId
    )
      return;
    handledKaraokeRequest.current = command.__eventId;
    const song = visibleSongs.find(
      (candidate) =>
        candidate?.id === command.songId ||
        (command.revision && candidate?.__roomRevision === command.revision)
    ) || {
      id: command.songId,
      __roomOwnerId: command.ownerId,
      __roomRevision: command.revision
    };
    openKaraoke(song);
  }, [openKaraoke, room?.room?.host, room?.roomCommand, visibleSongs]);

  const deleteRecording = useCallback(
    async (recording) => {
      if (!(await dialog.confirm(tr("karaoke.shouldIDeleteThisRecordedPerformance")))) return;
      try {
        await api.deleteRecording(recording.id);
        recordingsQuery.refresh();
      } catch (error) {
        await dialog.alert(tr("karaoke.failedToDeleteEntry", { 0: getErrorMessage(error) }));
      }
    },
    [dialog, recordingsQuery]
  );
  const cancelProcessing = useCallback(async () => {
    if (!processingSong || !(await dialog.confirm(tr("library.cancelProcessingOfThisSong"))))
      return;
    try {
      await api.cancelProcessing(processingSong.id);
      songsQuery.refresh();
    } catch (error) {
      await dialog.alert(tr("library.failedToCancelProcessing", { 0: getErrorMessage(error) }));
    }
  }, [dialog, processingSong, songsQuery]);

  const filteredSongs = useMemo(
    () => arrangeSongs(visibleSongs, query, filters),
    [visibleSongs, query, filters]
  );
  const filterOptions = useMemo(() => getLibraryFilterOptions(visibleSongs), [visibleSongs]);
  const readyCount = useMemo(() => countReadySongs(visibleSongs), [visibleSongs]);

  return {
    analysis,
    closeAnalysis,
    canManageLibrary: !room?.room || room.room.host,
    fileImport,
    fileInputRef,
    filteredSongs,
    filterOptions,
    filters,
    online: {
      open: onlineRoomOpen,
      setOpen: setOnlineRoomOpen,
      openRoom,
      name: app.settings?.online_name?.trim() || "",
      roomActive: Boolean(room?.room),
      setName: (online_name) =>
        app.updateSettings?.((current) => ({
          ...current,
          online_name
        }))
    },
    processing: {
      active: processingActive,
      cancel: cancelProcessing,
      close: closeProcessing,
      song: selectedProcessingSong,
      songs: processingSongs,
      status: statusQuery.data?.song_id === selectedProcessingSong?.id ? statusQuery.data : null,
      track
    },
    query,
    recordings: {
      delete: deleteRecording,
      error: recordingsQuery.error,
      items: recordingsQuery.data ?? [],
      setSong: setRecordingsSong,
      song: recordingsSong
    },
    readyCount,
    room,
    setAnalysis,
    setQuery,
    setFilters,
    settingsSongId,
    setSettingsSongId,
    songActions,
    songsError: songsQuery.error,
    totalCount: visibleSongs.length,
    transferStatuses: room?.transferStatuses,
    transitioning,
    navigate,
    openKaraoke
  };
}
