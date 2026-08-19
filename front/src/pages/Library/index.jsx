import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { OnlineRoomModal } from "../../components/OnlineRoomModal";
import { useAppDialog } from "../../contexts/AppDialog";
import { useOnlineRoom } from "../../contexts/OnlineRoomContext";
import useAppSettings from "../../hooks/useAppSettings";
import { usePolling } from "../../hooks/usePolling";
import { getOnlineNameMessage } from "../../hooks/useRequireOnlineName";
import { translateSaved } from "../../i18n/runtime";
import { POLLING_INTERVALS } from "../../runtime-config";
import { Grid, Stack } from "../../theme/ui";
import { getErrorMessage } from "../../utils/errors";
import { setProcessingLoadActive } from "../../utils/performance-profile";
import { setGlobalRouteBlackout } from "../../utils/route-blackout";
import PerformanceAnalysisModal from "../Karaoke/performance-analysis-modal";
import LibraryBackdrop from "./components/backdrop";
import LibraryHero from "./components/hero";
import LibrarySongCard from "./components/song-card";
import useLibraryFileImport from "./hooks/useFileImport";
import useLibraryRoomSync from "./hooks/useRoomSync";
import useLibrarySongActions from "./hooks/useSongActions";
import ProcessingModal from "./modals/processing";
import RecordingsModal from "./modals/recordings";
import {
  countReadySongs,
  filterSongs,
  getLocalVisibleSongs,
  hasActiveSongProcessing,
  isProcessingActive,
  mergeSongProcessingStatus,
  resolveVisibleSongs
} from "./utils";

function LibraryResults({ error, songs, children }) {
  if (error) {
    return (
      <p className="field-error">
        {translateSaved("Не удалось загрузить список:")}
        {getErrorMessage(error)}
      </p>
    );
  }
  if (!songs.length) {
    return (
      <div className="library-card-empty text-muted">
        {translateSaved("Пока нет ни одной песни — добавьте первую")}
      </div>
    );
  }
  return children;
}

export default function Library({ onOpenSongSettings }) {
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [recordingsSong, setRecordingsSong] = useState(null);
  const [processingSong, setProcessingSong] = useState(null);
  const [trackedSongId, setTrackedSongId] = useState(null);
  const [analysisRecordingId, setAnalysisRecordingId] = useState(
    () => location.state?.analysisRecordingId || null
  );
  const [hiddenSongIds, setHiddenSongIds] = useState(() => new Set());
  const [onlineRoomOpen, setOnlineRoomOpen] = useState(false);
  const returningFromKaraoke = Boolean(location.state?.fromKaraokeFade);
  const [karaokeTransitioning, setKaraokeTransitioning] = useState(returningFromKaraoke);
  const karaokeTransitioningRef = useRef(returningFromKaraoke);
  const remoteSongStatusesRef = useRef(new Map());
  const roomSyncQueueRef = useRef(Promise.resolve());
  const fileInputRef = useRef(null);
  const navigate = useNavigate();
  const { alert: notify, confirm: confirmDialog } = useAppDialog();
  const sharedRoom = useOnlineRoom();
  const activeRoom = sharedRoom?.room;
  const openKaraokeInRoom = sharedRoom?.openKaraoke;
  const { reloadSettings, settings, updateSettings } = useAppSettings();
  useEffect(() => {
    if (location.state?.analysisRecordingId)
      setAnalysisRecordingId(location.state.analysisRecordingId);
  }, [location.state?.analysisRecordingId]);
  useEffect(() => {
    if (!returningFromKaraoke) return undefined;

    // Library is mounted behind a black overlay. Let the analysis modal and
    // page render under that blackout, then reveal everything together.
    const timer = window.setTimeout(() => {
      karaokeTransitioningRef.current = false;
      setKaraokeTransitioning(false);
      // The app-level blackout survives the route swap and is released only
      // after Library has mounted, so the themed body can never flash through.
      setGlobalRouteBlackout(false);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [returningFromKaraoke]);
  const canManageLibrary = !sharedRoom?.room || sharedRoom.room.host;
  const { data: songs, error, refresh: refreshSongs } = usePolling(api.listSongs, 0, []);
  const trackProcessingSong = useCallback((song) => {
    setProcessingSong(song);
    setTrackedSongId(song?.id || null);
  }, []);
  const openOnlineRoom = async () => {
    let latestSettings;
    try {
      latestSettings = await reloadSettings();
    } catch (error) {
      await notify(
        translateSaved("Не удалось проверить настройки онлайн-режима: {0}", {
          0: getErrorMessage(error)
        })
      );
      return;
    }
    if (!String(latestSettings?.online_name ?? "").trim()) {
      await notify(getOnlineNameMessage());
      return;
    }
    setOnlineRoomOpen(true);
  };
  const {
    data: songRecordings,
    error: recordingsError,
    refresh: refreshRecordings
  } = usePolling(
    () => (recordingsSong ? api.listRecordingsForSong(recordingsSong.id) : Promise.resolve([])),
    0,
    [recordingsSong?.id]
  );
  const { data: processingStatus, error: processingStatusError } = usePolling(
    () => (trackedSongId ? api.getStatus(trackedSongId) : Promise.resolve(null)),
    trackedSongId ? POLLING_INTERVALS.processing : 0,
    [trackedSongId],
    {
      shouldContinue: (status) => isProcessingActive(status?.status),
      shouldRetryError: (requestError) => requestError?.status !== 404
    }
  );
  useEffect(() => {
    if (processingStatusError?.status !== 404) return;
    setTrackedSongId(null);
  }, [processingStatusError]);
  useEffect(() => {
    if (trackedSongId || !hasActiveSongProcessing(songs)) return;
    const activeSong = songs.find((song) => isProcessingActive(song?.status));
    setTrackedSongId(activeSong?.id || null);
  }, [songs, trackedSongId]);
  useEffect(() => {
    if (
      !trackedSongId ||
      processingStatus?.song_id !== trackedSongId ||
      isProcessingActive(processingStatus?.status)
    )
      return;

    // Keep the terminal status in the modal instead of dropping polling data
    // immediately and falling back to the stale Song object that still says
    // "processing". This was the reason the modal looked unprocessed after 100%.
    setProcessingSong((current) =>
      current?.id === trackedSongId
        ? {
            ...current,
            status: processingStatus.status,
            progress_step: processingStatus.progress_step,
            progress_percent: processingStatus.progress_percent,
            error_message: processingStatus.error_message
          }
        : current
    );
    let cancelled = false;
    Promise.resolve(refreshSongs()).finally(() => {
      if (!cancelled) setTrackedSongId(null);
    });
    return () => {
      cancelled = true;
    };
  }, [processingStatus, refreshSongs, trackedSongId]);
  const {
    importing,
    importFile: handleFileChosen,
    openFilePicker: handleAddClick
  } = useLibraryFileImport({
    fileInputRef,
    notify,
    onStarted: (song) => {
      trackProcessingSong(song);
      refreshSongs();
    }
  });
  const {
    deleteSong: handleDelete,
    openSongFolder: handleOpenFolder,
    processSong: handleProcess,
    reprocessSong: handleReprocess
  } = useLibrarySongActions({
    confirmDialog,
    notify,
    onChanged: refreshSongs,
    processingSongId: processingSong?.id,
    recordingsSongId: recordingsSong?.id,
    setHiddenSongIds,
    setProcessingSong: trackProcessingSong,
    setRecordingsSong
  });
  const handleDeleteRecording = useCallback(
    async (recording) => {
      if (!(await confirmDialog(translateSaved("Удалить это записанное исполнение?")))) return;
      try {
        await api.deleteRecording(recording.id);
        refreshRecordings();
      } catch (err) {
        await notify(translateSaved("Не удалось удалить запись: {0}", { 0: getErrorMessage(err) }));
      }
    },
    [confirmDialog, notify, refreshRecordings]
  );
  const cancelProcessing = useCallback(async () => {
    if (!processingSong || !(await confirmDialog(translateSaved("Отменить обработку этой песни?"))))
      return;
    try {
      await api.cancelProcessing(processingSong.id);
      refreshSongs();
    } catch (err) {
      await notify(
        translateSaved("Не удалось отменить обработку: {0}", { 0: getErrorMessage(err) })
      );
    }
  }, [confirmDialog, notify, processingSong, refreshSongs]);
  const currentSongs = mergeSongProcessingStatus(songs, processingStatus);
  const anySongProcessing = hasActiveSongProcessing(currentSongs);
  useEffect(() => {
    setProcessingLoadActive(anySongProcessing);
    return () => setProcessingLoadActive(false);
  }, [anySongProcessing]);
  const localVisibleSongs = getLocalVisibleSongs(currentSongs, hiddenSongIds);
  const visibleSongs = resolveVisibleSongs({
    localSongs: localVisibleSongs,
    room: sharedRoom?.room,
    roomSongs: sharedRoom?.roomUi?.songs,
    roomSongsByParticipant: sharedRoom?.roomUi?.songsByParticipant
  });
  useEffect(() => {
    if (!activeRoom) {
      remoteSongStatusesRef.current.clear();
      return;
    }
    const localIds = new Set(localVisibleSongs.map((song) => song.id));
    const nextStatuses = new Map();
    for (const song of visibleSongs) {
      if (!song?.id || song.__roomOwnerId === activeRoom.selfId) continue;
      const previousStatus = remoteSongStatusesRef.current.get(song.id);
      nextStatuses.set(song.id, song.status);
      if (
        previousStatus &&
        isProcessingActive(previousStatus) &&
        song.status === "done" &&
        !localIds.has(song.id) &&
        song.__roomRevision
      ) {
        roomSyncQueueRef.current = roomSyncQueueRef.current
          .catch(() => {})
          .then(() => sharedRoom.syncSong(song))
          .then(() => refreshSongs())
          // This automatic background sync has no caller to report to; syncSong() already
          // surfaces failures via transferStatus, so just prevent an unhandled rejection here.
          .catch(() => {});
      }
    }
    remoteSongStatusesRef.current = nextStatuses;
  }, [activeRoom, localVisibleSongs, refreshSongs, sharedRoom, visibleSongs]);

  useLibraryRoomSync({
    localSongs: localVisibleSongs,
    participantCount: sharedRoom?.participants?.length,
    query,
    room: sharedRoom?.room,
    roomEventId: sharedRoom?.roomUi?.__eventId,
    roomQuery: sharedRoom?.roomUi?.query,
    setQuery,
    syncUi: sharedRoom.syncUi
  });
  const filtered = filterSongs(visibleSongs, query);
  const readyCount = countReadySongs(visibleSongs);
  const openSongSettings = useCallback(
    (songId) => onOpenSongSettings?.(songId),
    [onOpenSongSettings]
  );
  const openSongInKaraoke = useCallback(
    async (selectedSong) => {
      if (karaokeTransitioningRef.current) return;
      karaokeTransitioningRef.current = true;
      try {
        if (activeRoom && !localVisibleSongs.some((song) => song.id === selectedSong.id)) {
          await sharedRoom.syncSong(selectedSong);
          await refreshSongs();
          if (!activeRoom.host) {
            karaokeTransitioningRef.current = false;
            return;
          }
        }
        if (activeRoom) {
          const readyLocally = await openKaraokeInRoom(selectedSong.id);
          if (!readyLocally) {
            karaokeTransitioningRef.current = false;
            return;
          }
        }
        setGlobalRouteBlackout(true);
        setKaraokeTransitioning(true);
        await new Promise((resolve) => {
          window.setTimeout(resolve, 920);
        });
        navigate("/karaoke", { state: { songId: selectedSong.id, autoPlay: true } });
      } catch (openError) {
        karaokeTransitioningRef.current = false;
        setKaraokeTransitioning(false);
        setGlobalRouteBlackout(false);
        await notify(
          translateSaved("Не удалось открыть песню: {0}", { 0: getErrorMessage(openError) })
        );
      }
    },
    [navigate, notify, activeRoom, localVisibleSongs, openKaraokeInRoom, refreshSongs, sharedRoom]
  );
  return (
    <Stack align="center" sx={{ height: "100vh" }}>
      <LibraryBackdrop />
      <Stack align="center" sx={{ width: "90%", height: "100vh", overflow: "visible" }}>
        <LibraryHero
          songCount={visibleSongs.length}
          readyCount={readyCount}
          canManageLibrary={canManageLibrary}
          fileInputRef={fileInputRef}
          includeFileInput
          importing={importing}
          onAdd={handleAddClick}
          onFileChosen={handleFileChosen}
          onOpenRoom={openOnlineRoom}
          roomActive={Boolean(sharedRoom?.room)}
          query={query}
          setQuery={setQuery}
        />
        <LibraryResults error={error} songs={filtered}>
          <Stack sx={{ width: "110%", overflow: "auto", overflowX: "hidden", padding: "0.5% 5%" }}>
            <Grid columns={3} gap={20} sx={{ margin: "1rem 0", marginBottom: "7rem" }}>
              {filtered.map((song, cardIndex) => (
                <LibrarySongCard
                  key={song.id}
                  canManageLibrary={canManageLibrary}
                  cardIndex={cardIndex}
                  song={song}
                  transferStatus={[...(sharedRoom?.transferStatuses?.values?.() || [])].find(
                    (status) => status.songId === song.id
                  )}
                  onDelete={handleDelete}
                  onOpenFolder={handleOpenFolder}
                  onOpenKaraoke={openSongInKaraoke}
                  onOpenProcessing={trackProcessingSong}
                  onOpenRecordings={setRecordingsSong}
                  onOpenSettings={openSongSettings}
                  onProcess={handleProcess}
                  onReprocess={handleReprocess}
                />
              ))}
            </Grid>
          </Stack>
        </LibraryResults>
      </Stack>

      <div
        className={`library-route-blackout ${karaokeTransitioning ? "is-visible" : ""}`}
        aria-hidden="true"
      />
      {onlineRoomOpen && (
        <OnlineRoomModal
          onlineName={settings?.online_name?.trim() || ""}
          onOnlineNameChange={(onlineName) =>
            updateSettings((current) => ({ ...current, online_name: onlineName }))
          }
          onClose={() => setOnlineRoomOpen(false)}
        />
      )}
      <RecordingsModal
        song={recordingsSong}
        recordings={songRecordings || []}
        error={recordingsError}
        onClose={() => setRecordingsSong(null)}
        onAnalyze={(recording) => {
          setRecordingsSong(null);
          setAnalysisRecordingId(recording.id);
        }}
        onDelete={handleDeleteRecording}
      />
      {analysisRecordingId && (
        <PerformanceAnalysisModal
          recordingId={analysisRecordingId}
          onClose={() => setAnalysisRecordingId(null)}
          onDone={() => setAnalysisRecordingId(null)}
          onDeleted={() => setAnalysisRecordingId(null)}
        />
      )}
      <ProcessingModal
        song={processingSong}
        status={processingStatus}
        onClose={() => setProcessingSong(null)}
        onCancel={cancelProcessing}
        onOpenKaraoke={(songId) => navigate("/karaoke", { state: { songId } })}
      />
    </Stack>
  );
}
