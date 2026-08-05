/* eslint-disable import/extensions */
import assert from "node:assert/strict";
import test from "node:test";
import { mockRequest, resetMockApi } from "../src/api/mock/request.js";

const cases = [
  ["GET", "/songs"],
  ["GET", "/settings"],
  ["GET", "/audio/settings"],
  ["GET", "/audio/devices"],
  ["GET", "/audio/output-devices"],
  ["GET", "/audio/asio-drivers"],
  ["GET", "/audio/signal-quality"],
  ["GET", "/recording/library"],
  ["GET", "/models/whisper"],
  ["GET", "/cache/size"],
  ["GET", "/cache/free-space"],
  ["GET", "/diagnostics/health"],
  ["GET", "/diagnostics/pipeline"],
  ["GET", "/diagnostics/versions"],
  ["GET", "/diagnostics/errors"],
  ["GET", "/history"],
  ["GET", "/about"]
];

for (const [method, path] of cases) {
  test(`mock API supports ${method} ${path}`, async () => {
    resetMockApi();
    const result = await mockRequest(path, { method });
    assert.notEqual(result, undefined);
  });
}

test("mock API returns isolated song snapshots", async () => {
  resetMockApi();
  const first = await mockRequest("/songs");
  first[0].title = "mutated";
  const second = await mockRequest("/songs");
  assert.equal(second[0].title, "Тестовая песня");
});

test("mock API updates a song without mutating caller data", async () => {
  resetMockApi();
  const patch = { title: "Новое название" };
  const updated = await mockRequest("/songs/mock-song-1", {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
  patch.title = "changed";
  assert.equal(updated.title, "Новое название");
});

test("mock API deletes songs", async () => {
  resetMockApi();
  await mockRequest("/songs/mock-song-1", { method: "DELETE" });
  const songs = await mockRequest("/songs");
  assert.equal(
    songs.some((song) => song.id === "mock-song-1"),
    false
  );
});

test("mock API resets mutable state", async () => {
  resetMockApi();
  await mockRequest("/songs/mock-song-1", {
    method: "PATCH",
    body: JSON.stringify({ title: "Changed" })
  });
  resetMockApi();
  const song = await mockRequest("/songs/mock-song-1");
  assert.equal(song.title, "Тестовая песня");
});

test("mock settings preserve explicit false and zero", async () => {
  resetMockApi();
  const result = await mockRequest("/settings", {
    method: "PATCH",
    body: JSON.stringify({ animations: false, fontScale: 0 })
  });
  assert.equal(result.animations, false);
  assert.equal(result.fontScale, 0);
});

test("mock audio settings are independently mutable", async () => {
  resetMockApi();
  const result = await mockRequest("/audio/settings", {
    method: "POST",
    body: JSON.stringify({ volume: 0.25, monitoring_enabled: true })
  });
  assert.equal(result.volume, 0.25);
  assert.equal(result.monitoring_enabled, true);
});

test("mock recording lifecycle produces a library item", async () => {
  resetMockApi();
  const session = await mockRequest("/recording/start", { method: "POST" });
  assert.equal(session.recording_session_id, "mock-session-1");
  const recording = await mockRequest(
    `/recording/stop?session_id=${session.recording_session_id}`,
    { method: "POST" }
  );
  const library = await mockRequest("/recording/library");
  assert.equal(library.length, 1);
  assert.equal(library[0].id, recording.id);
});

test("mock recording deletion removes the item", async () => {
  resetMockApi();
  const recording = await mockRequest("/recording/stop?session_id=x", {
    method: "POST"
  });
  await mockRequest(`/recording/${recording.id}`, { method: "DELETE" });
  assert.deepEqual(await mockRequest("/recording/library"), []);
});

test("mock API returns karaoke result fixtures", async () => {
  resetMockApi();
  const result = await mockRequest("/songs/mock-song-1/result");
  assert.ok(result.lyrics_sync.length > 0);
  assert.ok(result.reference_notes.length > 0);
});

test("mock API rejects unsupported routes loudly", async () => {
  await assert.rejects(
    mockRequest("/not-implemented"),
    /Mock API route is not implemented/
  );
});

test("malformed JSON bodies are treated as empty objects", async () => {
  resetMockApi();
  const before = await mockRequest("/settings");
  const after = await mockRequest("/settings", {
    method: "PATCH",
    body: "{"
  });
  assert.deepEqual(after, before);
});
