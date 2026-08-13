import { translateSaved } from "../../i18n/runtime";

export function formatLibraryDate(value, locale = "ru-RU") {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(locale);
}
export function formatEta(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0)
    return translateSaved("рассчитываем…");
  const rounded = Math.max(0, Math.round(value));
  if (!rounded) return translateSaved("рассчитываем…");
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return minutes
    ? translateSaved("~{0} мин {1} сек", {
        0: minutes,
        1: remainingSeconds
      })
    : translateSaved("~{0} сек", {
        0: remainingSeconds
      });
}
export function getProcessingProgress(status, song) {
  const raw = status?.progress_percent ?? song?.progress_percent ?? 0;
  const value = Number(raw);
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
export function isProcessingActive(status) {
  return (
    status === "processing" || status === "queued" || status === "cancelling"
  );
}
export function hasActiveSongProcessing(songs) {
  return (
    Array.isArray(songs) &&
    songs.some((song) => isProcessingActive(String(song?.status || "")))
  );
}
export function mergeSongProcessingStatus(songs, status) {
  if (!Array.isArray(songs) || !status?.song_id) return songs ?? [];
  const songId = String(status.song_id);
  return songs.map((song) =>
    String(song?.id) === songId
      ? {
          ...song,
          status: status.status ?? song.status,
          progress_step: status.progress_step ?? song.progress_step,
          progress_percent: status.progress_percent ?? song.progress_percent,
          error_message: status.error_message ?? song.error_message
        }
      : song
  );
}
export function getLocalVisibleSongs(songs, hiddenSongIds) {
  const hidden = hiddenSongIds instanceof Set ? hiddenSongIds : new Set();
  return Array.isArray(songs)
    ? songs.filter(
        (song) => song && typeof song === "object" && !hidden.has(song.id)
      )
    : [];
}
export function resolveVisibleSongs({ localSongs, room, roomSongs }) {
  if (room && !room.host && Array.isArray(roomSongs)) {
    return roomSongs.filter((song) => song && typeof song === "object");
  }
  return Array.isArray(localSongs) ? localSongs : [];
}
export function filterSongs(songs, query) {
  const normalizedQuery =
    typeof query === "string" ? query.trim().toLowerCase() : "";
  const source = Array.isArray(songs) ? songs : [];
  if (!normalizedQuery) return source;
  return source.filter((song) =>
    [song?.title, song?.artist, song?.genre]
      .filter((value) => typeof value === "string" && value.trim())
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery)
  );
}
export function countReadySongs(songs) {
  return Array.isArray(songs)
    ? songs.filter((song) => song?.status === "done").length
    : 0;
}
export function getSongCardState(song) {
  const status = typeof song?.status === "string" ? song.status : "pending";
  return {
    status,
    isWorking: isProcessingActive(status),
    isReady: status === "done"
  };
}
