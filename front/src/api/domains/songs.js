import {
  createFileUrl,
  encodePathSegment,
  request,
  requestBlob
} from "../core";
import { normalizeSong, normalizeSongList } from "../normalizers";

export const songsApi = {
  listSongs: () => request("/songs").then(normalizeSongList),
  getSong: (id) =>
    request(`/songs/${encodePathSegment(id)}`).then(normalizeSong),
  addSong: (file, title) => {
    const form = new FormData();
    form.append("file", file);
    if (title) form.append("title", title);
    return request("/songs", { method: "POST", body: form });
  },
  updateSong: (id, patch) =>
    request(`/songs/${encodePathSegment(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    }),
  deleteSong: (id) =>
    request(`/songs/${encodePathSegment(id)}`, { method: "DELETE" }),
  processSong: (id) =>
    request(`/songs/${encodePathSegment(id)}/process`, { method: "POST" }),
  reprocessMelody: (id) =>
    request(`/songs/${encodePathSegment(id)}/reprocess`, { method: "POST" }),
  cancelProcessing: (id) =>
    request(`/songs/${encodePathSegment(id)}/cancel`, { method: "POST" }),
  getStatus: (id) => request(`/songs/${encodePathSegment(id)}/status`),
  getLog: (id) => request(`/songs/${encodePathSegment(id)}/log`),
  getResult: (id) => request(`/songs/${encodePathSegment(id)}/result`),
  updateLyrics: (id, lyrics) =>
    request(`/songs/${encodePathSegment(id)}/lyrics`, {
      method: "PUT",
      body: JSON.stringify({ lyrics })
    }),
  getAudioTrackUrl: (id, track) =>
    createFileUrl(
      `/songs/${encodePathSegment(id)}/audio/${encodePathSegment(track)}`
    ),
  exportSongPackage: (rawId) => {
    const id = encodePathSegment(rawId);
    return requestBlob(`/songs/${id}/package`);
  },
  importSongPackage: (blob, filename = "song.karaoke.zip") => {
    const form = new FormData();
    form.append("file", blob, filename);
    return request("/songs/package/import", { method: "POST", body: form });
  }
};
