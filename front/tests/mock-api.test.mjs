import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { equal, deepEqual } from "./helpers/assertions.mjs";
test("mock fixtures preserve the complete development data contract", async () => {
  vi.resetModules();
  const {
    MOCK_SONG_ID,
    mockAppSettings,
    mockAudioSettings,
    mockKaraokeResult,
    mockSongEditor,
    mockSongs
  } = await import("../src/api/mock/fixtures.js");
  equal([MOCK_SONG_ID, "mock-song-1"]);
  deepEqual([mockSongs, [ { id: "mock-song-1", title: "Тестовая песня", artist: "A&D Voice", genre: "Pop", status: "done", progress_percent: 100, duration_sec: 185, key: "C", tempo: 120, video_url: "" }, { id: "mock-song-processing", title: "Песня в обработке", artist: "Demo", status: "processing", progress_percent: 48, progress_step: "Разделение дорожек" } ]], [mockKaraokeResult, { lyrics_sync: [ { start: 0, end: 5, text: "Добро пожаловать в A&D Voice", words: [ { text: "Добро", start: 0, end: 1 }, { text: "пожаловать", start: 1, end: 2.4 }, { text: "в", start: 2.4, end: 2.7 }, { text: "Karaoke", start: 2.7, end: 3.8 }, { text: "Studio", start: 3.8, end: 5 } ] }, { start: 5, end: 10, text: "Интерфейс работает без backend", words: [] } ], reference_notes: [ { start: 0.5, end: 1.2, midi: 60 }, { start: 1.3, end: 2.1, midi: 62 }, { start: 2.2, end: 3.2, midi: 64 }, { start: 3.3, end: 4.5, midi: 67 } ] }], [mockSongEditor, { ai_backup_exists: true, song_map: { duration: 10, syllables: [ { index: 0, text: "A&D", word_index: 0 }, { index: 1, text: "Voice", word_index: 1 } ], notes: [ { _id: "mock-note-1", start: 0.5, end: 1.5, midi_note: 60, velocity: 96, syllable_index: 0, word_index: 0 }, { _id: "mock-note-2", start: 1.5, end: 2.5, midi_note: 64, velocity: 96, syllable_index: 1, word_index: 1 } ] } }], [mockAppSettings, { online_name: "Тестовый пользователь", theme: "dark", accent: "purple", density: "comfortable", animations: true }], [mockAudioSettings, { volume: 1, reverb: 0, echo: 0, delay: 0, audio_driver: "auto", asio_driver_name: "", buffer_size: 64, monitoring_enabled: false }]);
});
test("mock API implements the complete development contract", async () => {
  vi.resetModules();
  const [{ api }, { MOCK_SONG_ID, mockSongs }, requestModule] =
    await Promise.all([
      import("../src/api/client.js"),
      import("../src/api/mock/fixtures.js"),
      import("../src/api/mock/request.js")
    ]);
  const { mockBlobRequest, mockRequest } = requestModule;
  const rejectsRoute = (path, options) =>
    assert.rejects(mockRequest(path, options), /not implemented/);
  deepEqual([await mockRequest("/recording/library"), []]);
  const originalSongs = await mockRequest("/songs");
  deepEqual([originalSongs, mockSongs]);
  originalSongs[0].title = "mutated outside store";
  equal([(await mockRequest("/songs"))[0].title, "Тестовая песня"]);
  const added = await mockRequest("/songs", { method: "post" });
  deepEqual([added, { id: "mock-song-3", title: "Новая песня", status: "processing", progress_percent: 0 }]);
  equal([(await mockRequest(`/songs/${added.id}`)).id, added.id], [( await mockRequest(`/songs/${added.id}`, { method: "PATCH", body: '{"title":"Changed"}' }) ).title, "Changed"], [( await mockRequest(`/songs/${added.id}`, { method: "PATCH", body: "broken" }) ).title, "Changed"], [await mockRequest(`/songs/${added.id}`, { method: "DELETE" }), null], [(await mockRequest("/songs")).some((song) => song.id === added.id), false], [await mockRequest("/songs/missing"), null], [await mockRequest("/songs/missing", { method: "DELETE" }), null]);
  await assert.rejects(
    mockRequest("/songs/missing", { method: "PUT" }),
    /Mock API route is not implemented/
  );
  deepEqual([await mockRequest("/songs/package/import", { method: "POST" }), { imported: true }]);
  assert.ok((await mockRequest(`/songs/${MOCK_SONG_ID}/result`)).lyrics_sync);
  const editorPath = `/songs/${MOCK_SONG_ID}/editor`;
  equal([(await mockRequest(editorPath)).song_map.notes.length, 2], [(await mockRequest("/songs/unknown/editor")).song_map.notes.length, 2]);
  deepEqual([await mockRequest(editorPath, { method: "PUT", body: '{"notes":[{"_id":"edited"}]}' }), { ai_backup_exists: true, song_map: { duration: 10, syllables: [ { index: 0, text: "A&D", word_index: 0 }, { index: 1, text: "Voice", word_index: 1 } ], notes: [{ _id: "edited" }] } }], [( await mockRequest("/songs/new/editor", { method: "PUT", body: "{}" }) ).song_map.notes, []], [( await mockRequest("/songs/new/editor", { method: "PUT", body: "broken" }) ).song_map.notes, []]);
  equal([( await mockRequest(`/songs/${MOCK_SONG_ID}/editor/reset`, { method: "POST" }) ).song_map.notes.length, 2], [(await mockRequest(`/songs/${MOCK_SONG_ID}/status`)).id, MOCK_SONG_ID]);
  for (const action of ["process", "reprocess", "cancel"])
    deepEqual([await mockRequest(`/songs/${MOCK_SONG_ID}/${action}`), { ok: true }]);
  deepEqual([await mockRequest(`/songs/${MOCK_SONG_ID}/lyrics`), { ok: true }], [await mockRequest(`/songs/${MOCK_SONG_ID}/log`), [ "Mock pipeline ready" ]]);
  const settings = await mockRequest("/settings");
  deepEqual([settings, { online_name: "Тестовый пользователь", theme: "dark", accent: "purple", density: "comfortable", animations: true }]);
  settings.theme = "external mutation";
  equal([(await mockRequest("/settings")).theme, "dark"], [( await mockRequest("/settings", { method: "PATCH", body: '{"accent":"red"}' }) ).accent, "red"]);
  deepEqual([await mockRequest("/audio/settings"), { volume: 1, reverb: 0, echo: 0, delay: 0, audio_driver: "auto", asio_driver_name: "", buffer_size: 64, monitoring_enabled: false }]);
  equal([( await mockRequest("/audio/settings", { method: "POST", body: '{"buffer_size":128}' }) ).buffer_size, 128]);
  for (const path of [ "/audio/devices", "/audio/output-devices", "/audio/asio-drivers" ])
    deepEqual([await mockRequest(path), []]);
  equal([(await mockRequest("/audio/signal-quality")).rms_dbfs, -42]);
  deepEqual([await mockRequest("/audio/direct-monitor/start"), { ok: true }]);
  equal([(await mockRequest("/recording/start")).recording_session_id, "mock-session-1"]);
  deepEqual([await mockRequest("/recording/pause?session_id=x"), { ok: true }], [await mockRequest("/recording/resume?session_id=x"), { ok: true }]);
  const recording = await mockRequest("/recording/stop?session_id=x");
  deepEqual([recording, { id: "mock-recording-1", song_id: "mock-song-1", duration_sec: 10, created_at: "1970-01-01T00:00:00.000Z" }]);
  const retainedRecording = await mockRequest( "/recording/stop?session_id=retained"
  );
  equal([(await mockRequest("/recording/library")).at(-1).id, retainedRecording.id], [(await mockRequest(`/recording/by-song/${MOCK_SONG_ID}`)).at(-1).id, retainedRecording.id], [await mockRequest(`/recording/${recording.id}`, { method: "DELETE" }), null]);
  deepEqual([await mockRequest("/recording/library"), [ retainedRecording ]], [await mockRequest("/analysis/id/run"), { queued: true }]);
  equal([(await mockRequest("/analysis/id")).accuracy_percent, 82]);
  deepEqual([await mockRequest("/analysis/id"), { accuracy_percent: 82, average_deviation_cents: 18, sections: [] }], [await mockRequest("/models/whisper"), []]);
  equal([(await mockRequest("/models/whisper/base/download")).ok, true]);
  deepEqual([await mockRequest("/diagnostics/ai-models"), { state: "ready", ready: true, ready_count: 5, total: 5, current_model: null, error: null, models_dir: "mock/models", models: [] }], [await mockRequest("/diagnostics/ai-models/download"), { state: "downloading", ready: false, ready_count: 0, total: 5, current_model: null, error: null, models_dir: "mock/models", models: [] }]);
  const mutableModelStatus = await mockRequest("/diagnostics/ai-models");
  mutableModelStatus.models.push({ name: "mutated" });
  deepEqual([(await mockRequest("/diagnostics/ai-models")).models, []]);
  equal([(await mockRequest("/cache/size")).bytes, 0]);
  assert.ok((await mockRequest("/cache/free-space")).bytes);
  equal([(await mockRequest("/cache/clear")).ok, true], [(await mockRequest("/diagnostics/health")).status, "ok"], [(await mockRequest("/diagnostics/pipeline")).status, "ok"]);
  deepEqual([await mockRequest("/diagnostics/versions"), {}], [await mockRequest("/diagnostics/errors"), []], [await mockRequest("/history"), []], [await mockRequest("/about"), { backend_version: "mock", ai_version: "mock", data_dir: "mock://data" }]);
  const blob = await mockBlobRequest(`/songs/${MOCK_SONG_ID}/package`);
  equal([blob.type, "application/zip"], [await blob.text(), "mock karaoke package"]);
  await assert.rejects( mockRequest("/missing", { method: "PUT" }), /not implemented/
  );
  await assert.rejects( mockBlobRequest("/missing", { method: "POST" }), /not implemented/
  );
  await assert.rejects(
    mockBlobRequest(`/songs/${MOCK_SONG_ID}/package`, { method: "POST" }),
    /not implemented/
  );
  for (const path of [
    `/prefix/songs/${MOCK_SONG_ID}/package`,
    `/songs/${MOCK_SONG_ID}/package/suffix`
  ])
    await assert.rejects(mockBlobRequest(path), /not implemented/);
  for (const path of [
    "/prefix/songs/mock-song-1",
    "/prefix/songs/mock-song-1/result",
    "/songs/mock-song-1/result/suffix",
    "/prefix/songs/mock-song-1/editor",
    "/songs/mock-song-1/editor/suffix",
    "/prefix/songs/mock-song-1/editor/reset",
    "/songs/mock-song-1/editor/reset/suffix",
    "/prefix/songs/mock-song-1/status",
    "/songs/mock-song-1/status/suffix",
    "/prefix/songs/mock-song-1/process",
    "/songs/mock-song-1/process/suffix",
    "/prefix/songs/mock-song-1/lyrics",
    "/songs/mock-song-1/lyrics/suffix",
    "/prefix/songs/mock-song-1/log",
    "/songs/mock-song-1/log/suffix",
    "/prefix/recording/by-song/mock-song-1",
    "/prefix/analysis/id/run",
    "/analysis/id/run/suffix",
    "/prefix/analysis/id",
    "/analysis/id/suffix"
  ])
    await rejectsRoute(path);
  for (const path of [
    "/recording/pause/suffix",
    "/recording/resume/suffix",
    "/recording/stop/suffix"
  ])
    await rejectsRoute(path, { method: "POST" });
  await rejectsRoute("/songs", { method: "PUT" });
  await rejectsRoute("/songs/package/import", { method: "GET" });
  await rejectsRoute("/recording/missing", { method: "GET" });
  await rejectsRoute("/prefix/recording/missing", { method: "DELETE" });
  await rejectsRoute("/recording/missing/suffix", { method: "DELETE" });
  equal([Object.isFrozen(api), true], [typeof api.listSongs, "function"]);
});
