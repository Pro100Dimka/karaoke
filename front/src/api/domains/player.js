import { encodePathSegment, request } from "../core";

export const playerApi = {
  getSync: (songId) => request(`/player/${encodePathSegment(songId)}/sync`),
  getTimeline: (songId) => request(`/player/${encodePathSegment(songId)}/timeline`),
  getPosition: (songId) => request(`/player/${encodePathSegment(songId)}/position`),
  seek: (songId, position_sec) =>
    request(`/player/${encodePathSegment(songId)}/seek`, {
      method: "POST",
      body: JSON.stringify({ position_sec })
    }),
  play: (songId) => request(`/player/${encodePathSegment(songId)}/resume`, { method: "POST" }),
  pause: (songId) => request(`/player/${encodePathSegment(songId)}/pause`, { method: "POST" }),
  stop: (songId) => request(`/player/${encodePathSegment(songId)}/stop`, { method: "POST" })
};
