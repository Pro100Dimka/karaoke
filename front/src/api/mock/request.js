/* eslint-disable import/extensions */
// eslint-disable-next-line import/extensions

import {
  MOCK_SONG_ID,
  mockAppSettings,
  mockAudioSettings,
  mockKaraokeResult,
  mockSongs
} from "./fixtures.js";

const clone = (value) =>
  value == null ? value : JSON.parse(JSON.stringify(value));

const store = {
  songs: clone(mockSongs),
  settings: clone(mockAppSettings),
  audioSettings: clone(mockAudioSettings),
  recordings: []
};

function parseBody(body) {
  if (body == null || typeof body !== "string") return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function findSong(id) {
  return store.songs.find((song) => song.id === id) || null;
}

export async function mockRequest(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const url = new URL(path, "http://mock.local");
  const { pathname } = url;
  const body = parseBody(options.body);

  if (pathname === "/songs" && method === "GET") return clone(store.songs);
  if (pathname === "/songs" && method === "POST") {
    const song = {
      id: `mock-song-${store.songs.length + 1}`,
      title: "Новая песня",
      status: "processing",
      progress_percent: 0
    };
    store.songs.push(song);
    return clone(song);
  }
  if (pathname === "/songs/package/import" && method === "POST") {
    return { imported: true };
  }

  const songMatch = pathname.match(/^\/songs\/([^/]+)$/);
  if (songMatch) {
    const song = findSong(songMatch[1]);
    if (method === "GET") return clone(song);
    if (method === "PATCH" && song) {
      Object.assign(song, body);
      return clone(song);
    }
    if (method === "DELETE") {
      store.songs = store.songs.filter((item) => item.id !== songMatch[1]);
      return null;
    }
  }

  const resultMatch = pathname.match(/^\/songs\/([^/]+)\/result$/);
  if (resultMatch) return clone(mockKaraokeResult);
  const statusMatch = pathname.match(/^\/songs\/([^/]+)\/status$/);
  if (statusMatch) return clone(findSong(statusMatch[1]));
  if (/^\/songs\/[^/]+\/(process|reprocess|cancel)$/.test(pathname)) {
    return { ok: true };
  }
  if (/^\/songs\/[^/]+\/lyrics$/.test(pathname)) return { ok: true };
  if (/^\/songs\/[^/]+\/log$/.test(pathname)) return ["Mock pipeline ready"];

  if (pathname === "/settings") {
    if (method === "GET") return clone(store.settings);
    Object.assign(store.settings, body);
    return clone(store.settings);
  }

  if (pathname === "/audio/settings") {
    if (method === "GET") return clone(store.audioSettings);
    Object.assign(store.audioSettings, body);
    return clone(store.audioSettings);
  }
  if (pathname === "/audio/devices") return [];
  if (pathname === "/audio/output-devices") return [];
  if (pathname === "/audio/asio-drivers") return [];
  if (pathname === "/audio/signal-quality") return { rms_dbfs: -42 };
  if (pathname.startsWith("/audio/direct-monitor/")) return { ok: true };

  if (pathname === "/recording/start") {
    return { recording_session_id: "mock-session-1" };
  }
  if (pathname.startsWith("/recording/pause")) return { ok: true };
  if (pathname.startsWith("/recording/resume")) return { ok: true };
  if (pathname.startsWith("/recording/stop")) {
    const recording = {
      id: `mock-recording-${store.recordings.length + 1}`,
      song_id: MOCK_SONG_ID,
      duration_sec: 10,
      created_at: new Date(0).toISOString()
    };
    store.recordings.push(recording);
    return clone(recording);
  }
  if (pathname === "/recording/library") return clone(store.recordings);
  if (/^\/recording\/by-song\//.test(pathname)) return clone(store.recordings);
  if (/^\/recording\/[^/]+$/.test(pathname) && method === "DELETE") {
    store.recordings = store.recordings.filter(
      (recording) => recording.id !== pathname.split("/").pop()
    );
    return null;
  }

  if (/^\/analysis\/[^/]+\/run$/.test(pathname)) return { queued: true };
  if (/^\/analysis\/[^/]+$/.test(pathname)) {
    return {
      accuracy_percent: 82,
      average_deviation_cents: 18,
      sections: []
    };
  }

  if (pathname === "/models/whisper") return [];
  if (pathname === "/diagnostics/ai-models")
    return {
      state: "ready",
      ready: true,
      ready_count: 5,
      total: 5,
      current_model: null,
      error: null,
      models_dir: "mock/models",
      models: []
    };
  if (pathname === "/diagnostics/ai-models/download")
    return {
      state: "downloading",
      ready: false,
      ready_count: 0,
      total: 5,
      current_model: null,
      error: null,
      models_dir: "mock/models",
      models: []
    };
  if (pathname.startsWith("/models/whisper/")) return { ok: true };
  if (pathname === "/cache/size") return { bytes: 0 };
  if (pathname === "/cache/free-space") return { bytes: 1024 ** 3 };
  if (pathname.startsWith("/cache/")) return { ok: true };
  if (pathname === "/diagnostics/health") return { status: "ok" };
  if (pathname === "/diagnostics/pipeline") return { status: "ok" };
  if (pathname === "/diagnostics/versions") return {};
  if (pathname === "/diagnostics/errors") return [];
  if (pathname === "/history") return [];
  if (pathname === "/about") {
    return {
      backend_version: "mock",
      ai_version: "mock",
      data_dir: "mock://data"
    };
  }

  throw new Error(`Mock API route is not implemented: ${method} ${pathname}`);
}
export async function mockBlobRequest(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const { pathname } = new URL(path, "http://mock.local");
  if (method === "GET" && /^\/songs\/[^/]+\/package$/.test(pathname)) {
    return new Blob(["mock karaoke package"], { type: "application/zip" });
  }
  throw new Error(
    `Mock blob API route is not implemented: ${method} ${pathname}`
  );
}
