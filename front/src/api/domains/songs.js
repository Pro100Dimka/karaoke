import { createFileUrl, encodePathSegment, request, requestBlob } from "../core";
import { normalizeSong, normalizeSongList } from "../normalizers";

export const songsApi = {
  listSongs: () => request("/songs").then(normalizeSongList),
  getSong: (id) => request(`/songs/${encodePathSegment(id)}`).then(normalizeSong),
  getSongRevision: (id) => request(`/songs/${encodePathSegment(id)}/revision`),
  addSong: (file, title) => {
    const form = new FormData();
    form.append("file", file);
    if (title) form.append("title", title);
    return request("/songs", { method: "POST", body: form, timeoutMs: 5 * 60_000 });
  },
  updateSong: (id, patch) =>
    request(`/songs/${encodePathSegment(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteSong: (id) => request(`/songs/${encodePathSegment(id)}`, { method: "DELETE" }),
  processSong: (id) => request(`/songs/${encodePathSegment(id)}/process`, { method: "POST" }),
  reprocessMelody: (id) => request(`/songs/${encodePathSegment(id)}/reprocess`, { method: "POST" }),
  cancelProcessing: (id) => request(`/songs/${encodePathSegment(id)}/cancel`, { method: "POST" }),
  getStatus: (id) => request(`/songs/${encodePathSegment(id)}/status`),
  getLog: (id) => request(`/songs/${encodePathSegment(id)}/log`),
  getResult: (id) => request(`/songs/${encodePathSegment(id)}/result`),
  getSongEditor: (id) => request(`/songs/${encodePathSegment(id)}/editor`),
  saveSongEditor: (id, notes) =>
    request(`/songs/${encodePathSegment(id)}/editor`, {
      method: "PUT",
      body: JSON.stringify({ notes })
    }),
  resetSongEditor: (id) =>
    request(`/songs/${encodePathSegment(id)}/editor/reset`, { method: "POST" }),
  updateLyrics: (id, lyrics) =>
    request(`/songs/${encodePathSegment(id)}/lyrics`, {
      method: "PUT",
      body: JSON.stringify({ lyrics })
    }),
  getSongCoverUrl: (id) => createFileUrl(`/songs/${encodePathSegment(id)}/cover`),
  getAudioTrackUrl: (id, track) =>
    createFileUrl(`/songs/${encodePathSegment(id)}/audio/${encodePathSegment(track)}`),
  exportSongPackage: (rawId, expectedRevision) => {
    const id = encodePathSegment(rawId);
    const query = expectedRevision
      ? `?expected_revision=${encodeURIComponent(expectedRevision)}`
      : "";
    return requestBlob(`/songs/${id}/package${query}`, { timeoutMs: 5 * 60_000 });
  },
  importSongPackage: (blob, filename = "song.karaoke.zip", options = {}) => {
    const { expectedRevision, ...requestOptions } = options;
    const form = new FormData();
    const query = expectedRevision
      ? `?expected_revision=${encodeURIComponent(expectedRevision)}`
      : "";
    form.append("file", blob, filename);
    return request(`/songs/package/import${query}`, {
      ...requestOptions,
      method: "POST",
      body: form,
      timeoutMs: 5 * 60_000
    });
  }
};
