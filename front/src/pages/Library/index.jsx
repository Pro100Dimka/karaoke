import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { OnlineRoomModal } from "../../components/OnlineRoomModal";
import { Panel } from "../../components/ui";
import { useAppDialog } from "../../contexts/AppDialog";
import { useOnlineRoom } from "../../contexts/OnlineRoomContext";
import { usePolling } from "../../hooks/usePolling";
import { getErrorMessage } from "../../utils/errors";
import PerformanceAnalysisModal from "../Karaoke/components/PerformanceAnalysisModal";
import LibraryActions from "./components/LibraryActions";
import LibraryBackdrop from "./components/LibraryBackdrop";
import LibraryHero from "./components/LibraryHero";
import LibrarySongCard from "./components/LibrarySongCard";
import ProcessingModal from "./components/ProcessingModal";
import RecordingsModal from "./components/RecordingsModal";
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
  const [appSettings, setAppSettings] = useState(null);
  const applyingRemoteRoomUiRef = useRef(false);
  const fileInputRef = useRef(null);
  const navigate = useNavigate();
  const { alert: notify, confirm: confirmDialog } = useAppDialog();
  const sharedRoom = useOnlineRoom();
  const canManageLibrary = !sharedRoom?.room || sharedRoom.room.host;

  const { data: songs, error } = usePolling(api.listSongs, 3000, []);
  useEffect(() => {
    api
      .getAppSettings()
      .then(setAppSettings)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (typeof sharedRoom?.roomUi?.query !== "string") return;
    if (sharedRoom.roomUi.query === query) {
      applyingRemoteRoomUiRef.current = false;
      return;
    }
    applyingRemoteRoomUiRef.current = true;
    setQuery(sharedRoom.roomUi.query);
  }, [sharedRoom?.roomUi?.__eventId]);
  useEffect(() => {
    if (!sharedRoom?.room) return;
    if (applyingRemoteRoomUiRef.current) {
      applyingRemoteRoomUiRef.current = false;
      return;
    }
    sharedRoom.syncUi({ query });
  }, [query, sharedRoom?.room]);

  const openOnlineRoom = async () => {
    let settings = appSettings;
    try {
      settings = await api.getAppSettings();
      setAppSettings(settings);
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

  const handleAddClick = useCallback(() => fileInputRef.current?.click(), []);

  const handleFileChosen = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      try {
        const song = await api.addSong(file, file.name.replace(/\.[^.]+$/, ""));
        await api.processSong(song.id);
        setProcessingSong(song);
      } catch (err) {
        await notify(
          `Не удалось добавить и запустить обработку песни: ${getErrorMessage(err)}`
        );
      }
    },
    [notify]
  );

  const handleDelete = useCallback(
    async (song) => {
      if (
        !(await confirmDialog(
          `Удалить «${song.title}»? Это удалит все файлы песни.`,
          "Удалить песню?"
        ))
      )
        return;
      try {
        setHiddenSongIds((ids) => new Set(ids).add(song.id));
        if (recordingsSong?.id === song.id) setRecordingsSong(null);
        if (processingSong?.id === song.id) setProcessingSong(null);
        await api.deleteSong(song.id);
      } catch (err) {
        setHiddenSongIds((ids) => {
          const next = new Set(ids);
          next.delete(song.id);
          return next;
        });
        await notify(`Не удалось удалить: ${getErrorMessage(err)}`);
      }
    },
    [confirmDialog, notify, processingSong?.id, recordingsSong?.id]
  );

  const handleProcess = useCallback(
    async (song) => {
      try {
        await api.processSong(song.id);
        setProcessingSong(song);
      } catch (err) {
        await notify(`Не удалось запустить обработку: ${getErrorMessage(err)}`);
      }
    },
    [notify]
  );

  const handleReprocess = useCallback(
    async (song) => {
      try {
        await api.reprocessMelody(song.id);
        setProcessingSong(song);
      } catch (err) {
        await notify(`Не удалось переобработать MIDI: ${getErrorMessage(err)}`);
      }
    },
    [notify]
  );

  const handleOpenFolder = useCallback(
    async (song) => {
      if (!song.output_dir && !window.electronAPI) {
        await notify("Папка ещё не создана — песня не обработана");
        return;
      }
      window.electronAPI?.openSongFolder(song.output_dir || "");
    },
    [notify]
  );

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
  const librarySyncSignature = useMemo(
    () => JSON.stringify(localVisibleSongs),
    [songs, hiddenSongIds]
  );
  useEffect(() => {
    if (!sharedRoom?.room?.host) return;
    sharedRoom.syncUi({ songs: localVisibleSongs });
  }, [
    librarySyncSignature,
    sharedRoom?.participants?.length,
    sharedRoom?.room?.host
  ]);
  const filtered = filterSongs(visibleSongs, query);
  const readyCount = countReadySongs(visibleSongs);

  return (
    <div className="library-page">
      <LibraryBackdrop />
      <LibraryHero songCount={visibleSongs.length} readyCount={readyCount} />
      <Panel className="library-collection-panel">
        <div className="library-toolbar u-row-between">
          <div className="library-search">
            <Search className="library-search-icon" size={14} />
            <input
              className="input library-search-input"
              placeholder="Поиск..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <LibraryActions
            canManageLibrary={canManageLibrary}
            fileInputRef={fileInputRef}
            includeFileInput
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
                if (sharedRoom?.room) {
                  const readyLocally = await sharedRoom.openKaraoke(
                    selectedSong.id
                  );
                  if (!readyLocally) return;
                }
                navigate("/karaoke", { state: { songId: selectedSong.id } });
              }}
              onOpenProcessing={setProcessingSong}
              onOpenRecordings={setRecordingsSong}
              onOpenSettings={(songId) => onOpenSongSettings?.(songId)}
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
          onlineName={appSettings?.online_name?.trim() || ""}
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
