// Тонкий клиент к локальному backend'у (FastAPI на 127.0.0.1:8000).
// Никакой отдельной библиотеки (axios и т.п.) не тянем — обычного fetch
// достаточно для локального REST API.

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

async function request(path, options = {}) {
  const { headers, body, ...requestOptions } = options;
  const res = await fetch(`${BASE_URL}${path}`, {
    ...requestOptions,
    body,
    headers: body instanceof FormData
      ? headers
      : { "Content-Type": "application/json", ...headers },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail ?? data);
    } catch {
      // ответ без тела — оставляем statusText
    }
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  // Песни
  listSongs: () => request("/songs"),
  getSong: (id) => request(`/songs/${id}`),
  addSong: (file, title) => {
    const form = new FormData();
    form.append("file", file);
    if (title) form.append("title", title);
    return request("/songs", { method: "POST", body: form });
  },
  updateSong: (id, patch) => request(`/songs/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteSong: (id) => request(`/songs/${id}`, { method: "DELETE" }),
  processSong: (id) => request(`/songs/${id}/process`, { method: "POST" }),
  cancelProcessing: (id) => request(`/songs/${id}/cancel`, { method: "POST" }),
  getStatus: (id) => request(`/songs/${id}/status`),
  getLog: (id) => request(`/songs/${id}/log`),
  getResult: (id) => request(`/songs/${id}/result`),
  updateLyrics: (id, lyrics) => request(`/songs/${id}/lyrics`, { method: "PUT", body: JSON.stringify({ lyrics }) }),
  getAudioTrackUrl: (id, track) => `${BASE_URL}/songs/${id}/audio/${track}`,

  // Плеер
  getSync: (songId) => request(`/player/${songId}/sync`),
  getTimeline: (songId) => request(`/player/${songId}/timeline`),
  getPosition: (songId) => request(`/player/${songId}/position`),
  seek: (songId, position_sec) =>
    request(`/player/${songId}/seek`, { method: "POST", body: JSON.stringify({ position_sec }) }),
  play: (songId) => request(`/player/${songId}/resume`, { method: "POST" }),
  pause: (songId) => request(`/player/${songId}/pause`, { method: "POST" }),
  stop: (songId) => request(`/player/${songId}/stop`, { method: "POST" }),

  // Запись
  getRecordingSettings: () => request("/recording/settings"),
  startRecording: (songId, positionSec = 0) =>
    request("/recording/start", { method: "POST", body: JSON.stringify({ song_id: songId, position_sec: positionSec }) }),
  pauseRecording: (sessionId) => request(`/recording/pause?session_id=${sessionId}`, { method: "POST" }),
  resumeRecording: (sessionId) => request(`/recording/resume?session_id=${sessionId}`, { method: "POST" }),
  stopRecording: (sessionId) => request(`/recording/stop?session_id=${sessionId}`, { method: "POST" }),
  listRecordingsForSong: (songId) => request(`/recording/by-song/${songId}`),
  listRecordingLibrary: () => request("/recording/library"),
  deleteRecording: (id) => request(`/recording/${id}`, { method: "DELETE" }),
  getRecordingFileUrl: (id) => `${BASE_URL}/recording/${id}/file`,
  getPerformanceFileUrl: (id) => `${BASE_URL}/recording/${id}/performance`,

  // Анализ
  runAnalysis: (recordingId) => request(`/analysis/${recordingId}/run`, { method: "POST" }),
  getAnalysis: (recordingId) => request(`/analysis/${recordingId}`),

  // Кэш
  getCacheSize: () => request("/cache/size"),
  getFreeSpace: () => request("/cache/free-space"),
  clearCache: () => request("/cache/clear", { method: "POST" }),
  deleteTemp: () => request("/cache/temp", { method: "DELETE" }),
  optimizeSong: (songId) => request(`/cache/optimize/${songId}`, { method: "POST" }),

  // Диагностика
  getHealth: () => request("/diagnostics/health"),
  getPipelineHealth: () => request("/diagnostics/pipeline"),
  getVersions: () => request("/diagnostics/versions"),
  getErrors: () => request("/diagnostics/errors"),

  // Аудио
  listAudioDevices: () => request("/audio/devices"),
  getAudioSettings: () => request("/audio/settings"),
  updateAudioSettings: (patch) =>
    request("/audio/settings", { method: "POST", body: JSON.stringify(patch) }),
  startDirectMonitoring: () => request("/audio/direct-monitor/start", { method: "POST" }),
  stopDirectMonitoring: () => request("/audio/direct-monitor/stop", { method: "POST" }),
  getSignalQuality: () => request("/audio/signal-quality"),

  // Настройки программы
  getAppSettings: () => request("/settings"),
  updateAppSettings: (patch) => request("/settings", { method: "PATCH", body: JSON.stringify(patch) }),

  // Модели AI
  listWhisperModels: () => request("/models/whisper"),
  downloadModel: (name) => request(`/models/whisper/${name}/download`, { method: "POST" }),
  deleteModel: (name) => request(`/models/whisper/${name}`, { method: "DELETE" }),
  selectModel: (name) => request(`/models/whisper/${name}/select`, { method: "POST" }),

  // История
  getHistory: () => request("/history"),

  // О программе
  getAbout: () => request("/about"),
};
