import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { OnlineRoomModal } from "../../components/OnlineRoomModal";
import { useAppDialog } from "../../contexts/AppDialog";
import { useOnlineRoom } from "../../contexts/OnlineRoomContext";
import useAppSettings from "../../hooks/useAppSettings";
import { usePolling } from "../../hooks/usePolling";
import { Grid, Stack } from "../../theme/ui";
import { getErrorMessage } from "../../utils/errors";
import PerformanceAnalysisModal from "../Karaoke/modals/performance-analysis-modal";
import LibraryBackdrop from "./components/backdrop";
import LibraryHero from "./components/hero";
import LibrarySongCard from "./components/song-card";
import useLibraryFileImport from "./hooks/use-file-import";
import useLibraryRoomSync from "./hooks/use-room-sync";
import useLibrarySongActions from "./hooks/use-song-actions";
import ProcessingModal from "./modals/processing";
import RecordingsModal from "./modals/recordings";
import {
  countReadySongs,
  filterSongs,
  getLocalVisibleSongs,
  hasActiveSongProcessing,
  isProcessingActive,
  resolveVisibleSongs
} from "./utils";

const setGlobalRouteBlackout = (visible) => {
  window.dispatchEvent(
    new CustomEvent("app:route-blackout", { detail: { visible } })
  );
};

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
  const [karaokeTransitioning, setKaraokeTransitioning] =
    useState(returningFromKaraoke);
  const fileInputRef = useRef(null);
  const navigate = useNavigate();
  const { alert: notify, confirm: confirmDialog } = useAppDialog();
  const sharedRoom = useOnlineRoom();
  const activeRoom = sharedRoom?.room;
  const openKaraokeInRoom = sharedRoom?.openKaraoke;
  const { reloadSettings, settings } = useAppSettings();

  useEffect(() => {
    if (location.state?.analysisRecordingId) {
      setAnalysisRecordingId(location.state.analysisRecordingId);
    }
  }, [location.state?.analysisRecordingId]);

  useEffect(() => {
    if (!returningFromKaraoke) return undefined;

    // Library is mounted behind a black overlay. Let the analysis modal and
    // page render under that blackout, then reveal everything together.
    const timer = window.setTimeout(() => {
      setKaraokeTransitioning(false);
      // The app-level blackout survives the route swap and is released only
      // after Library has mounted, so the themed body can never flash through.
      setGlobalRouteBlackout(false);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [returningFromKaraoke]);

  const canManageLibrary = !sharedRoom?.room || sharedRoom.room.host;
  const {
    data: songs,
    error,
    refresh: refreshSongs
  } = usePolling(api.listSongs, 0, []);

  const trackProcessingSong = useCallback((song) => {
    setProcessingSong(song);
    setTrackedSongId(song?.id || null);
  }, []);
  const openOnlineRoom = async () => {
    let settings;
    try {
      settings = await reloadSettings();
    } catch (error) {
      await notify(
        `Не удалось проверить настройки онлайн-режима: ${getErrorMessage(error)}`
      );
      return;
    }
    if (!settings?.online_name?.trim()) {
      await notify(
        "Сначала укажите имя в настройках приложения — оно нужно другим участникам комнаты."
      );
      return;
    }
    setOnlineRoomOpen(true);
  };
  const {
    data: songRecordings,
    error: recordingsError,
    refresh: refreshRecordings
  } = usePolling(
    () =>
      recordingsSong
        ? api.listRecordingsForSong(recordingsSong.id)
        : Promise.resolve([]),
    0,
    [recordingsSong?.id]
  );
  const { data: processingStatus, error: processingStatusError } = usePolling(
    () =>
      trackedSongId ? api.getStatus(trackedSongId) : Promise.resolve(null),
    trackedSongId ? 1000 : 0,
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
    refreshSongs();
    setTrackedSongId(null);
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
      if (!(await confirmDialog("Удалить это записанное исполнение?"))) return;
      try {
        await api.deleteRecording(recording.id);
        refreshRecordings();
      } catch (err) {
        await notify(`Не удалось удалить запись: ${getErrorMessage(err)}`);
      }
    },
    [confirmDialog, notify, refreshRecordings]
  );

  const cancelProcessing = useCallback(async () => {
    if (
      !processingSong ||
      !(await confirmDialog("Отменить обработку этой песни?"))
    )
      return;
    try {
      await api.cancelProcessing(processingSong.id);
      refreshSongs();
    } catch (err) {
      await notify(`Не удалось отменить обработку: ${getErrorMessage(err)}`);
    }
  }, [confirmDialog, notify, processingSong, refreshSongs]);

  const localVisibleSongs = getLocalVisibleSongs(songs, hiddenSongIds);
  const visibleSongs = resolveVisibleSongs({
    localSongs: localVisibleSongs,
    room: sharedRoom?.room,
    roomSongs: sharedRoom?.roomUi?.songs
  });
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
      if (karaokeTransitioning) return;

      try {
        if (activeRoom) {
          const readyLocally = await openKaraokeInRoom(selectedSong.id);
          if (!readyLocally) return;
        }

        setGlobalRouteBlackout(true);
        setKaraokeTransitioning(true);
        await new Promise((resolve) => {
          window.setTimeout(resolve, 920);
        });
        navigate("/karaoke", {
          state: { songId: selectedSong.id, autoPlay: true }
        });
      } catch (openError) {
        setKaraokeTransitioning(false);
        setGlobalRouteBlackout(false);
        await notify(`Не удалось открыть песню: ${getErrorMessage(openError)}`);
      }
    },
    [karaokeTransitioning, navigate, notify, activeRoom, openKaraokeInRoom]
  );
  return (
    <Stack align="center" sx={{ height: "100vh" }}>
      <LibraryBackdrop />
      <Stack
        align="center"
        sx={{ width: "90%", height: "100vh", overflow: "visible" }}
      >
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
        {error ? (
          <p className="field-error">
            Не удалось загрузить список: {getErrorMessage(error)}
          </p>
        ) : filtered.length === 0 ? (
          <div className="library-card-empty text-muted">
            Пока нет ни одной песни — добавьте первую
          </div>
        ) : (
          <Stack
            sx={{
              width: "110%",
              overflow: "auto",
              overflowX: "hidden",
              padding: "0.5% 5%"
            }}
          >
            <Grid
              columns={3}
              gap={20}
              sx={{ margin: "1rem 0", marginBottom: "7rem" }}
              // minItemWidth="30rem"
              // sx={{
              //   width: "100%",
              //   alignItems: "stretch",
              //   alignContent: "start",
              //   overflow: "visible"
              // }}
            >
              {filtered.map((song, cardIndex) => (
                <LibrarySongCard
                  key={song.id}
                  canManageLibrary={canManageLibrary}
                  cardIndex={cardIndex}
                  song={song}
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
        )}
      </Stack>

      <div
        className={`library-route-blackout ${karaokeTransitioning ? "is-visible" : ""}`}
        aria-hidden="true"
      />
      {onlineRoomOpen && (
        <OnlineRoomModal
          onlineName={settings?.online_name?.trim() || ""}
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
