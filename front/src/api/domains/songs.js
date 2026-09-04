import { createFileUrl, encodePathSegment, request, requestBlob } from "../core";
import { normalizeSong, normalizeSongList } from "../normalizers";

export const songsApi = {
  listSongs: () => request("/songs").then(normalizeSongList),
  inspectSongIdentity: (file) => {
    const form = new FormData();
    form.append("file", file);
    return request("/songs/identity", { method: "POST", body: form, timeoutMs: 5 * 60_000 });
  },
  prepareKarDataset: (files) => {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    return request("/songs/training/kar", {
      method: "POST",
      body: form,
      timeoutMs: 2 * 60 * 60_000
    });
  },
  getSong: (id) => request(`/songs/${encodePathSegment(id)}`).then(normalizeSong),
  getSongRevision: (id) => request(`/songs/${encodePathSegment(id)}/revision`),
  getSongRevisions: (ids) =>
    request("/songs/revisions", { method: "POST", body: JSON.stringify({ song_ids: ids }) }),
  resolveSongRevision: (revision) =>
    request("/songs/revision/resolve", {
      method: "POST",
      body: JSON.stringify({ revision })
    }),
  addSong: (file, title, artist = "") => {
    const form = new FormData();
    form.append("file", file);
    if (title) form.append("title", title);
    form.append("artist", artist);
    return request("/songs", { method: "POST", body: form, timeoutMs: 5 * 60_000 });
  },
  updateSong: (id, patch) =>
    request(`/songs/${encodePathSegment(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteSong: (id) => request(`/songs/${encodePathSegment(id)}`, { method: "DELETE" }),
  processSong: (id, mode = "auto") =>
    request(`/songs/${encodePathSegment(id)}/process`, {
      method: "POST",
      body: JSON.stringify({ mode })
    }),
  reprocessMelody: (id) => request(`/songs/${encodePathSegment(id)}/reprocess`, { method: "POST" }),
  cancelProcessing: (id) => request(`/songs/${encodePathSegment(id)}/cancel`, { method: "POST" }),
  getStatus: (id) => request(`/songs/${encodePathSegment(id)}/status`),
  getLog: (id) => request(`/songs/${encodePathSegment(id)}/log`),
  getResult: (id) => request(`/songs/${encodePathSegment(id)}/result`),
  getSongEditor: (id) => request(`/songs/${encodePathSegment(id)}/editor`),
  saveSongEditor: (id, notes, wordTexts, wordBounds) =>
    request(`/songs/${encodePathSegment(id)}/editor`, {
      method: "PUT",
      body: JSON.stringify({
        notes,
        word_texts: wordTexts ?? null,
        word_bounds: wordBounds ?? null
      })
    }),
  resetSongEditor: (id) =>
    request(`/songs/${encodePathSegment(id)}/editor/reset`, { method: "POST" }),
  updateLyrics: (id, lyrics) =>
    request(`/songs/${encodePathSegment(id)}/lyrics`, {
      method: "PUT",
      body: JSON.stringify({ lyrics })
    }),
  getSongCoverUrl: (id, version) => {
    const suffix = version ? `?v=${encodeURIComponent(version)}` : "";
    return createFileUrl(`/songs/${encodePathSegment(id)}/cover${suffix}`);
  },
  getAudioTrackUrl: (id, track) =>
    createFileUrl(`/songs/${encodePathSegment(id)}/audio/${encodePathSegment(track)}`),
  getAudioTrackBlob: (id, track) =>
    requestBlob(`/songs/${encodePathSegment(id)}/audio/${encodePathSegment(track)}`),
  getSongVideoUrl: (id) => createFileUrl(`/songs/${encodePathSegment(id)}/video`),
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
