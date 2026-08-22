import { translateSaved as tr } from "../../i18n/runtime";

const ACTIVE = new Set(["processing", "queued", "cancelling"]);
const array = (value) => (Array.isArray(value) ? value : []);

export const formatLibraryDate = (value, locale = "ru-RU") => {
  const date = value && new Date(value);
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(locale) : "—";
};

export const formatEta = (seconds) => {
  const rounded = Math.round(Number(seconds));
  if (!Number.isFinite(rounded) || rounded <= 0) return tr("рассчитываем…");
  const minutes = Math.floor(rounded / 60);
  return minutes
    ? tr("~{0} мин {1} сек", { 0: minutes, 1: rounded % 60 })
    : tr("~{0} сек", { 0: rounded });
};

export const getProcessingProgress = (status, song) =>
  Math.min(100, Math.max(0, Number(status?.progress_percent ?? song?.progress_percent) || 0));
export const isProcessingActive = (status) => ACTIVE.has(String(status));
export const hasActiveSongProcessing = (songs) =>
  array(songs).some((song) => isProcessingActive(song?.status));
export const getProcessingSongs = (songs) => {
  const rank = { processing: 0, cancelling: 1, queued: 2 };
  return array(songs)
    .map((song, index) => ({ song, index }))
    .filter(({ song }) => isProcessingActive(song?.status))
    .sort((a, b) => (rank[a.song.status] ?? 3) - (rank[b.song.status] ?? 3) || a.index - b.index)
    .map(({ song }) => song);
};

export const mergeSongProcessingStatus = (songs, status) =>
  !Array.isArray(songs) || !status?.song_id
    ? (songs ?? [])
    : songs.map((song) =>
        String(song?.id) !== String(status.song_id)
          ? song
          : ["status", "progress_step", "progress_percent", "error_message"].reduce(
              (next, key) => ({ ...next, [key]: status[key] ?? song[key] }),
              { ...song }
            )
      );

export const getLocalVisibleSongs = (songs, hidden) =>
  array(songs).filter((song) => song && typeof song === "object" && !hidden?.has?.(song.id));

export const resolveVisibleSongs = ({ localSongs, room, roomSongs, roomSongsByParticipant }) => {
  if (!room || room.host) return array(localSongs);
  const merged = new Map();
  [...Object.values(roomSongsByParticipant || {}).flatMap(array), ...array(roomSongs)].forEach(
    (song) => song?.id && !merged.has(song.id) && merged.set(song.id, song)
  );
  return merged.size ? [...merged.values()] : array(localSongs);
};

export const filterSongs = (songs, query) => {
  const needle = String(query || "")
    .trim()
    .toLowerCase();
  return needle
    ? array(songs).filter((song) =>
        [song?.title, song?.artist, song?.genre]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle)
      )
    : array(songs);
};

export const defaultLibraryFilters = Object.freeze({
  sort: "relevance",
  genre: "",
  key: "",
  status: ""
});

const songKey = (song) => String(song?.key_override ?? song?.key ?? "").trim();
const normalized = (value) =>
  String(value || "")
    .trim()
    .toLocaleLowerCase();
const unique = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
const timestamp = (value) => Date.parse(value) || 0;

export const getLibraryFilterOptions = (songs) => ({
  genres: unique(array(songs).map((song) => String(song?.genre || "").trim())),
  keys: unique(array(songs).map(songKey))
});

export const arrangeSongs = (songs, query, filters = defaultLibraryFilters) => {
  const result = filterSongs(songs, query).filter(
    (song) =>
      (!filters.genre || normalized(song?.genre) === normalized(filters.genre)) &&
      (!filters.key || normalized(songKey(song)) === normalized(filters.key)) &&
      (!filters.status ||
        (filters.status === "active"
          ? isProcessingActive(song?.status)
          : song?.status === filters.status))
  );
  const text = (value) => String(value || "");
  const compare = {
    title: (left, right) => text(left.title).localeCompare(text(right.title)),
    artist: (left, right) => text(left.artist).localeCompare(text(right.artist)),
    recent: (left, right) => timestamp(right.created_at) - timestamp(left.created_at)
  }[filters.sort];
  return compare ? [...result].sort(compare) : result;
};

export const countReadySongs = (songs) =>
  array(songs).filter(({ status }) => status === "done").length;
export const getSongCardState = (song) => {
  const status = typeof song?.status === "string" && song.status ? song.status : "pending";
  return { status, isWorking: isProcessingActive(status), isReady: status === "done" };
};

export const formatSongKey = (value) => {
  const key = String(value || "").trim();
  return key
    ? key.replace(/\s+minor$/i, "m").replace(/\s+major$/i, "maj")
    : tr("Тональность определяется");
};
