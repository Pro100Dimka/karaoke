import { createFileUrl, request, requestBlob } from "../core";
import { normalizeSong, normalizeSongList } from "../normalizers";

export const songsApi = {
  listSongs: () => request("/songs").then(normalizeSongList),
  getSong: (id) => request(`/songs/${id}`).then(normalizeSong),
  addSong: (file, title) => {
    const form = new FormData();
    form.append("file", file);
    if (title) form.append("title", title);
    return request("/songs", { method: "POST", body: form });
  },
  updateSong: (id, patch) =>
    request(`/songs/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteSong: (id) => request(`/songs/${id}`, { method: "DELETE" }),
  processSong: (id) => request(`/songs/${id}/process`, { method: "POST" }),
  reprocessMelody: (id) =>
    request(`/songs/${id}/reprocess`, { method: "POST" }),
  cancelProcessing: (id) => request(`/songs/${id}/cancel`, { method: "POST" }),
  getStatus: (id) => request(`/songs/${id}/status`),
  getLog: (id) => request(`/songs/${id}/log`),
  getResult: (id) => request(`/songs/${id}/result`),
  updateLyrics: (id, lyrics) =>
    request(`/songs/${id}/lyrics`, {
      method: "PUT",
      body: JSON.stringify({ lyrics })
    }),
  getAudioTrackUrl: (id, track) => createFileUrl(`/songs/${id}/audio/${track}`),
  exportSongPackage: (id) => requestBlob(`/songs/${id}/package`),
  importSongPackage: (blob, filename = "song.karaoke.zip") => {
    const form = new FormData();
    form.append("file", blob, filename);
    return request("/songs/package/import", { method: "POST", body: form });
  }
};
