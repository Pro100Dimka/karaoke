import { Search } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { OnlineRoomModal } from "../../components/OnlineRoomModal";
import { Card, Panel } from "../../components/ui";
import { useAppDialog } from "../../contexts/AppDialog";
import { useOnlineRoom } from "../../contexts/OnlineRoomContext";
import useAppSettings from "../../hooks/useAppSettings";
import { usePolling } from "../../hooks/usePolling";
import { getErrorMessage } from "../../utils/errors";
import PerformanceAnalysisModal from "../Karaoke/modals/performance-analysis-modal";
import LibraryActions from "./components/actions";
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
  resolveVisibleSongs
} from "./utils";

export default function Library({ onOpenSongSettings }) {
  const [query, setQuery] = useState("");
  const [recordingsSong, setRecordingsSong] = useState(null);
  const [processingSong, setProcessingSong] = useState(null);
  const [analysisRecordingId, setAnalysisRecordingId] = useState(null);
  const [hiddenSongIds, setHiddenSongIds] = useState(() => new Set());
  const [onlineRoomOpen, setOnlineRoomOpen] = useState(false);
  const fileInputRef = useRef(null);
  const navigate = useNavigate();
  const { alert: notify, confirm: confirmDialog } = useAppDialog();
  const sharedRoom = useOnlineRoom();
  const { reloadSettings, settings } = useAppSettings();

  const canManageLibrary = !sharedRoom?.room || sharedRoom.room.host;
  const { data: songs, error } = usePolling(api.listSongs, 3000, []);
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
  const { data: songRecordings, error: recordingsError } = usePolling(
    () =>
      recordingsSong
        ? api.listRecordingsForSong(recordingsSong.id)
        : Promise.resolve([]),
    2500,
    [recordingsSong?.id]
  );
  const { data: processingStatus } = usePolling(
    () =>
      processingSong ? api.getStatus(processingSong.id) : Promise.resolve(null),
    1000,
    [processingSong?.id]
  );

  const {
    importing,
    importFile: handleFileChosen,
    openFilePicker: handleAddClick
  } = useLibraryFileImport({
      fileInputRef,
      notify,
      onStarted: setProcessingSong
    });

  const {
    deleteSong: handleDelete,
    openSongFolder: handleOpenFolder,
    processSong: handleProcess,
    reprocessSong: handleReprocess
  } = useLibrarySongActions({
    confirmDialog,
    notify,
    processingSongId: processingSong?.id,
    recordingsSongId: recordingsSong?.id,
    setHiddenSongIds,
    setProcessingSong,
    setRecordingsSong
  });

  const handleDeleteRecording = useCallback(
    async (recording) => {
      if (!(await confirmDialog("Удалить это записанное исполнение?"))) return;
      try {
        await api.deleteRecording(recording.id);
      } catch (err) {
        await notify(`Не удалось удалить запись: ${getErrorMessage(err)}`);
      }
    },
    [confirmDialog, notify]
  );

  const cancelProcessing = useCallback(async () => {
    if (
      !processingSong ||
      !(await confirmDialog("Отменить обработку этой песни?"))
    )
      return;
    try {
      await api.cancelProcessing(processingSong.id);
    } catch (err) {
      await notify(`Не удалось отменить обработку: ${getErrorMessage(err)}`);
    }
  }, [confirmDialog, notify, processingSong]);

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
  return (
    <div className="library-page">
      <LibraryBackdrop />
      <LibraryHero songCount={visibleSongs.length} readyCount={readyCount} />
      <Panel className="library-collection-panel">
        <div className="library-toolbar u-row-between">
          <Card
            className="library-search"
            variant="neon"
            cardPanel={{ style: { background: "unset" } }}
          >
            <Search className="library-search-icon" size={14} />
            <input
              className="input library-search-input"
              placeholder="Поиск..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </Card>
          <LibraryActions
            canManageLibrary={canManageLibrary}
            fileInputRef={fileInputRef}
            includeFileInput
            importing={importing}
            onAdd={handleAddClick}
            onFileChosen={handleFileChosen}
            onOpenRoom={openOnlineRoom}
            roomActive={Boolean(sharedRoom?.room)}
          />
        </div>

        {error && (
          <p className="field-error">
            Не удалось загрузить список: {getErrorMessage(error)}
          </p>
        )}

        <div className="library-card-deck">
          {filtered.map((song, cardIndex) => (
            <LibrarySongCard
              key={`card-${song.id}`}
              canManageLibrary={canManageLibrary}
              cardIndex={cardIndex}
              song={song}
              onDelete={handleDelete}
              onOpenFolder={handleOpenFolder}
              onOpenKaraoke={async (selectedSong) => {
                try {
                  if (sharedRoom?.room) {
                    const readyLocally = await sharedRoom.openKaraoke(
                      selectedSong.id
                    );
                    if (!readyLocally) return;
                  }
                  navigate("/karaoke", {
                    state: { songId: selectedSong.id }
                  });
                } catch (openError) {
                  await notify(
                    `Не удалось открыть песню: ${getErrorMessage(openError)}`
                  );
                }
              }}
              onOpenProcessing={setProcessingSong}
              onOpenRecordings={setRecordingsSong}
              onOpenSettings={() => onOpenSongSettings?.(song.id)}
              onProcess={handleProcess}
              onReprocess={handleReprocess}
            />
          ))}
          {filtered.length === 0 && !error && (
            <div className="library-card-empty text-muted">
              Пока нет ни одной песни — добавьте первую
            </div>
          )}
        </div>
      </Panel>
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
    </div>
  );
}
