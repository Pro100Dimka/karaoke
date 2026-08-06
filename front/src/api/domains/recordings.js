import { createFileUrl, request } from "../core";
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
    request(`/recording/pause?session_id=${sessionId}`, { method: "POST" }),
  resumeRecording: (sessionId) =>
    request(`/recording/resume?session_id=${sessionId}`, { method: "POST" }),
  stopRecording: (sessionId) =>
    request(`/recording/stop?session_id=${sessionId}`, { method: "POST" }),
  listRecordingsForSong: (songId) =>
    request(`/recording/by-song/${songId}`).then((items) =>
      Array.isArray(items) ? items.map(normalizeRecording) : []
    ),
  listRecordingLibrary: () =>
    request("/recording/library").then((items) =>
      Array.isArray(items) ? items.map(normalizeRecording) : []
    ),
  deleteRecording: (id) => request(`/recording/${id}`, { method: "DELETE" }),
  getRecordingFileUrl: (id) => createFileUrl(`/recording/${id}/file`),
  getPerformanceFileUrl: (id) => createFileUrl(`/recording/${id}/performance`),
  runAnalysis: (recordingId) =>
    request(`/analysis/${recordingId}/run`, { method: "POST" }),
  getAnalysis: (recordingId) => request(`/analysis/${recordingId}`)
};
