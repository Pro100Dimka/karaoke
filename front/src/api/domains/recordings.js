import { createFileUrl, encodePathSegment, request } from "../core";
import { normalizeRecording } from "../normalizers";

export const recordingsApi = {
  getRecordingSettings: () => request("/recording/settings"),
  startRecording: (
    songId,
    positionSec = 0,
    musicVolume = 1,
    microphoneVolume = 1,
    reverb = 0,
    echo = 0,
    delay = 0
  ) =>
    request("/recording/start", {
      method: "POST",
      body: JSON.stringify({
        song_id: songId,
        position_sec: positionSec,
        music_volume: musicVolume,
        microphone_volume: microphoneVolume,
        reverb,
        echo,
        delay
      })
    }),
  pauseRecording: (sessionId) =>
    request(
      `/recording/pause?session_id=${encodeURIComponent(String(sessionId ?? ""))}`,
      { method: "POST" }
    ),
  resumeRecording: (sessionId) =>
    request(
      `/recording/resume?session_id=${encodeURIComponent(String(sessionId ?? ""))}`,
      { method: "POST" }
    ),
  stopRecording: (sessionId) =>
    request(
      `/recording/stop?session_id=${encodeURIComponent(String(sessionId ?? ""))}`,
      { method: "POST" }
    ),
  listRecordingsForSong: (songId) =>
    request(`/recording/by-song/${encodePathSegment(songId)}`).then((items) =>
      Array.isArray(items) ? items.map(normalizeRecording) : []
    ),
  listRecordingLibrary: () =>
    request("/recording/library").then((items) =>
      Array.isArray(items) ? items.map(normalizeRecording) : []
    ),
  deleteRecording: (id) =>
    request(`/recording/${encodePathSegment(id)}`, { method: "DELETE" }),
  getRecordingFileUrl: (id) =>
    createFileUrl(`/recording/${encodePathSegment(id)}/file`),
  getPerformanceFileUrl: (id) =>
    createFileUrl(`/recording/${encodePathSegment(id)}/performance`),
  runAnalysis: (recordingId) =>
    request(`/analysis/${encodePathSegment(recordingId)}/run`, { method: "POST" }),
  getAnalysis: (recordingId) =>
    request(`/analysis/${encodePathSegment(recordingId)}`)
};
