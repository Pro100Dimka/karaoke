/* eslint-disable import/extensions */
// eslint-disable-next-line import/extensions

import {
  MOCK_SONG_ID,
  mockAppSettings,
  mockAudioSettings,
  mockKaraokeResult,
  mockSongEditor,
  mockSongs
} from "./fixtures";
import { MOCK_SILENT_AUDIO_URL } from "./media";

const clone = globalThis.structuredClone;

function decodeDataUrl(url) {
  const separator = url.indexOf(",");
  const mimeType = url.slice(5, separator).split(";")[0];
  const binary = globalThis.atob(url.slice(separator + 1));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

const STATIC_RESPONSES = Object.freeze({
  "/audio/devices": [],
  "/audio/output-devices": [],
  "/audio/asio-drivers": [],
  "/audio/signal-quality": { rms_dbfs: -42 },
  "/recording/pause": { ok: true },
  "/recording/resume": { ok: true },
  "/models/whisper": [],
  "/diagnostics/ai-models": {
    state: "ready",
    ready: true,
    ready_count: 5,
    total: 5,
    current_model: null,
    error: null,
    models_dir: "mock/models",
    models: []
  },
  "/diagnostics/ai-models/download": {
    state: "downloading",
    ready: false,
    ready_count: 0,
    total: 5,
    current_model: null,
    error: null,
    models_dir: "mock/models",
    models: []
  },
  "/cache/size": { bytes: 0 },
  "/cache/free-space": { bytes: 1024 ** 3 },
  "/diagnostics/health": { status: "ok" },
  "/diagnostics/pipeline": { status: "ok" },
  "/diagnostics/versions": {},
  "/diagnostics/errors": [],
  "/history": [],
  "/about": {
    backend_version: "mock",
    ai_version: "mock",
    data_dir: "mock://data"
  }
});

const store = {
  songs: clone(mockSongs),
  settings: clone(mockAppSettings),
  audioSettings: clone(mockAudioSettings),
  editors: {},
  recordings: []
};

function parseBody(body) {
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
  if (pathname === "/songs/identity" && method === "POST") {
    return { title: "Новая песня", artist: "Исполнитель" };
  }
  if (pathname === "/songs/package/import" && method === "POST") return { imported: true };

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
  const editorMatch = pathname.match(/^\/songs\/([^/]+)\/editor$/);
  if (editorMatch) {
    const id = editorMatch[1];
    if (method === "PUT") {
      const current = store.editors[id] || clone(mockSongEditor);
      const words = current.lyrics_sync.words.map((word) => ({ ...word, notes: [] }));
      for (const note of body.notes || []) {
        if (words[note.word_index]) {
          words[note.word_index].notes.push({ note: note.note, start: note.start, end: note.end });
        }
      }
      store.editors[id] = {
        ...current,
        lyrics_sync: { ...current.lyrics_sync, words }
      };
    }
    return clone(store.editors[id] || mockSongEditor);
  }
  const editorResetMatch = pathname.match(/^\/songs\/([^/]+)\/editor\/reset$/);
  if (editorResetMatch) {
    store.editors[editorResetMatch[1]] = clone(mockSongEditor);
    return clone(mockSongEditor);
  }
  const statusMatch = pathname.match(/^\/songs\/([^/]+)\/status$/);
  if (statusMatch) return clone(findSong(statusMatch[1]));
  if (/^\/songs\/[^/]+\/(process|reprocess|cancel|lyrics)$/.test(pathname)) return { ok: true };
  if (/^\/songs\/[^/]+\/log$/.test(pathname)) return ["Mock pipeline ready"];

  if (pathname === "/settings") {
    Object.assign(store.settings, body);
    return clone(store.settings);
  }

  if (pathname === "/audio/settings") {
    Object.assign(store.audioSettings, body);
    return clone(store.audioSettings);
  }
  if (Object.hasOwn(STATIC_RESPONSES, pathname)) return clone(STATIC_RESPONSES[pathname]);
  if (pathname.startsWith("/audio/direct-monitor/")) return { ok: true };

  if (pathname === "/recording/start") return { recording_session_id: "mock-session-1" };
  if (pathname === "/recording/stop") {
    const recording = {
      id: `mock-recording-${store.recordings.length + 1}`,
      song_id: MOCK_SONG_ID,
      duration_sec: 10,
      created_at: new Date(0).toISOString()
    };
    store.recordings.push(recording);
    return clone(recording);
  }
  if (pathname === "/recording/library" || /^\/recording\/by-song\//.test(pathname)) {
    return clone(store.recordings);
  }
  if (/^\/recording\/[^/]+$/.test(pathname) && method === "DELETE") {
    store.recordings = store.recordings.filter(
      (recording) => recording.id !== pathname.split("/").pop()
    );
    return null;
  }

  if (/^\/analysis\/[^/]+\/run$/.test(pathname)) return { queued: true };
  if (/^\/analysis\/[^/]+$/.test(pathname)) {
    return { accuracy_percent: 82, average_deviation_cents: 18, sections: [] };
  }

  if (["/models/whisper/", "/cache/"].some((prefix) => pathname.startsWith(prefix)))
    return { ok: true };

  throw new Error(`Mock API route is not implemented: ${method} ${pathname}`);
}
export async function mockBlobRequest(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const { pathname } = new URL(path, "http://mock.local");
  if (method === "GET" && /^\/songs\/[^/]+\/audio\/[^/]+$/.test(pathname)) {
    return decodeDataUrl(MOCK_SILENT_AUDIO_URL);
  }
  if (method === "GET" && /^\/songs\/[^/]+\/package$/.test(pathname)) {
    return new Blob(["mock karaoke package"], { type: "application/zip" });
  }
  throw new Error(`Mock blob API route is not implemented: ${method} ${pathname}`);
}
