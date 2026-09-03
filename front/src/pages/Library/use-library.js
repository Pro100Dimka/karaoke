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
import { getErrorMessage } from "../../utils/errors";
import useLibraryFileImport from "./hooks/use-fileImport";
import useLibraryKaraoke from "./hooks/use-karaoke";
import useLibraryProcessing from "./hooks/use-processing";
import useLibraryRecordings from "./hooks/use-recordings";
import useLibraryRoomSync from "./hooks/use-room-sync";
import useLibrarySongActions from "./hooks/use-song-actions";
import {
  arrangeSongs,
  countReadySongs,
  defaultLibraryFilters,
  getLibraryFilterOptions,
  getLocalVisibleSongs,
  resolveVisibleSongs
} from "./utils";

function useObjectState(initial) {
  const [state, setState] = useState(initial);

  const set = useCallback((key, value) => {
    setState((state) => ({
      ...state,
      [key]: typeof value === "function" ? value(state[key]) : value
    }));
  }, []);

  return [state, set];
}

export default function useLibrary() {
  const location = useLocation();
  const navigate = useNavigate();
  const dialog = useAppDialog();
  const online = useOnlineRoom();
  const app = useAppSettings();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(defaultLibraryFilters);
  const [hiddenSongIds, setHiddenSongIds] = useState(new Set());
  const [ui, setUi] = useObjectState({
    filtersOpen: false,
    settingsSongId: null,
    onlineRoomOpen: false,
    analysis: {
      analysisRecordingId: location.state?.analysisRecordingId || null,
      analysisRecordings: []
    }
  });
  const fileInputRef = useRef(null);
  const { room } = online;
  const roomUi = online.roomUi || {};
  const songsQuery = usePolling(api.listSongs, 0, [], { queryKey: queryKeys.songs });
  const { refresh } = songsQuery;
  const processing = useLibraryProcessing(songsQuery, dialog);
  const recordings = useLibraryRecordings(dialog);
  const localSongs = useMemo(
    () => getLocalVisibleSongs(processing.currentSongs, hiddenSongIds),
    [processing.currentSongs, hiddenSongIds]
  );

  const visibleSongs = useMemo(
    () =>
      resolveVisibleSongs({
        localSongs,
        room,
        roomSongs: roomUi.songs,
        roomSongsByParticipant: roomUi.songsByParticipant
      }),
    [localSongs, room, roomUi.songs, roomUi.songsByParticipant]
  );

  const library = useMemo(
    () => ({
      filteredSongs: arrangeSongs(visibleSongs, query, filters),
      filterOptions: getLibraryFilterOptions(visibleSongs),
      readyCount: countReadySongs(visibleSongs)
    }),
    [visibleSongs, query, filters]
  );

  const karaoke = useLibraryKaraoke({
    room: online,
    localSongs,
    visibleSongs,
    refresh,
    navigate,
    alert: dialog.alert,
    returning: !!location.state?.fromKaraokeFade
  });

  const fileImport = useLibraryFileImport({
    fileInputRef,
    notify: dialog.alert,
    onStarted: (song) => {
      processing.track(song);
      refresh();
    }
  });

  const songActions = useLibrarySongActions({
    confirmDialog: dialog.confirm,
    notify: dialog.alert,
    onChanged: refresh,
    processingSongId: processing.song?.id,
    recordingsSongId: recordings.song?.id,
    setHiddenSongIds,
    setProcessingSong: processing.track,
    setRecordingsSong: recordings.setSong
  });

  const setFiltersOpen = useCallback((value) => setUi("filtersOpen", value), [setUi]);

  useLibraryRoomSync({
    localSongs,
    query,
    filters,
    filtersOpen: ui.filtersOpen,
    room,
    roomEventId: roomUi.__eventId,
    roomQuery: roomUi.query,
    roomFilters: roomUi.filters,
    roomFiltersOpen: roomUi.libraryFiltersOpen,
    participantCount: online.participants?.length,
    setQuery,
    setFilters,
    setFiltersOpen,
    syncUi: online.syncUi
  });

  useEffect(() => {
    const id = location.state?.analysisRecordingId;

    if (id) {
      setUi("analysis", (analysis) => ({
        ...analysis,
        analysisRecordingId: id
      }));
    }
  }, [location.state?.analysisRecordingId, setUi]);

  const openRoom = async () => {
    try {
      const name = (await app.reloadSettings())?.online_name?.trim();

      if (!name) return dialog.alert(getOnlineNameMessage());

      setUi("onlineRoomOpen", true);
    } catch (error) {
      await dialog.alert(
        tr("library.failedToCheckOnlineModeSettings", {
          0: getErrorMessage(error)
        })
      );
    }
  };

  return {
    ...library,

    query,
    setQuery,
    filters,
    setFilters,
    hiddenSongIds,

    filtersOpen: ui.filtersOpen,
    setFiltersOpen,

    analysis: ui.analysis,
    setAnalysis: (value) => setUi("analysis", value),
    closeAnalysis: () =>
      setUi("analysis", {
        analysisRecordingId: null,
        analysisRecordings: []
      }),

    settingsSongId: ui.settingsSongId,
    setSettingsSongId: (value) => setUi("settingsSongId", value),

    online: {
      open: ui.onlineRoomOpen,
      setOpen: (value) => setUi("onlineRoomOpen", value),
      openRoom,
      name: app.settings?.online_name?.trim() || "",
      roomActive: !!room,
      setName: (online_name) =>
        app.updateSettings?.((settings) => ({
          ...settings,
          online_name
        }))
    },

    fileImport,
    fileInputRef,
    processing,
    recordings,
    songActions,

    room: online,
    transferStatuses: online.transferStatuses,

    canManageLibrary: !room || room.host,
    totalCount: visibleSongs.length,
    songsError: songsQuery.error,

    transitioning: karaoke.transitioning,
    openKaraoke: karaoke.openKaraoke,
    navigate
  };
}
