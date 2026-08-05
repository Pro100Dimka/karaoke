import { request } from "../core";

export const playerApi = {
  getSync: (songId) => request(`/player/${songId}/sync`),
  getTimeline: (songId) => request(`/player/${songId}/timeline`),
  getPosition: (songId) => request(`/player/${songId}/position`),
  seek: (songId, position_sec) =>
    request(`/player/${songId}/seek`, {
      method: "POST",
      body: JSON.stringify({ position_sec })
    }),
  play: (songId) => request(`/player/${songId}/resume`, { method: "POST" }),
  pause: (songId) => request(`/player/${songId}/pause`, { method: "POST" }),
  stop: (songId) => request(`/player/${songId}/stop`, { method: "POST" })
};
