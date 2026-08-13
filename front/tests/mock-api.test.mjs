import assert from "node:assert/strict";
import { test } from "vitest";

import { api } from "../src/api/client.js";
import { MOCK_SONG_ID } from "../src/api/mock/fixtures.js";
import { mockBlobRequest, mockRequest } from "../src/api/mock/request.js";

test("mock API implements the complete development contract", async () => {
  assert.equal((await mockRequest("/songs")).length >= 2, true);
  const added = await mockRequest("/songs", { method: "post" });
  assert.equal((await mockRequest(`/songs/${added.id}`)).id, added.id);
  assert.equal(
    (await mockRequest(`/songs/${added.id}`, { method: "PATCH", body: '{"title":"Changed"}' })).title,
    "Changed"
  );
  assert.equal(
    (await mockRequest(`/songs/${added.id}`, { method: "PATCH", body: "broken" })).title,
    "Changed"
  );
  assert.equal(await mockRequest(`/songs/${added.id}`, { method: "DELETE" }), null);
  assert.equal(await mockRequest("/songs/missing"), null);
  assert.deepEqual(await mockRequest("/songs/package/import", { method: "POST" }), { imported: true });
  assert.ok((await mockRequest(`/songs/${MOCK_SONG_ID}/result`)).lyrics_sync);
  assert.equal((await mockRequest(`/songs/${MOCK_SONG_ID}/status`)).id, MOCK_SONG_ID);
  for (const action of ["process", "reprocess", "cancel"])
    assert.deepEqual(await mockRequest(`/songs/${MOCK_SONG_ID}/${action}`), { ok: true });
  assert.deepEqual(await mockRequest(`/songs/${MOCK_SONG_ID}/lyrics`), { ok: true });
  assert.deepEqual(await mockRequest(`/songs/${MOCK_SONG_ID}/log`), ["Mock pipeline ready"]);

  const settings = await mockRequest("/settings");
  assert.ok(settings.theme);
  assert.equal(
    (await mockRequest("/settings", { method: "PATCH", body: '{"accent":"red"}' })).accent,
    "red"
  );
  assert.ok((await mockRequest("/audio/settings")).audio_driver);
  assert.equal(
    (await mockRequest("/audio/settings", { method: "POST", body: '{"buffer_size":128}' }))
      .buffer_size,
    128
  );
  for (const path of ["/audio/devices", "/audio/output-devices", "/audio/asio-drivers"])
    assert.deepEqual(await mockRequest(path), []);
  assert.equal((await mockRequest("/audio/signal-quality")).rms_dbfs, -42);
  assert.deepEqual(await mockRequest("/audio/direct-monitor/start"), { ok: true });

  assert.equal((await mockRequest("/recording/start")).recording_session_id, "mock-session-1");
  assert.deepEqual(await mockRequest("/recording/pause?session_id=x"), { ok: true });
  assert.deepEqual(await mockRequest("/recording/resume?session_id=x"), { ok: true });
  const recording = await mockRequest("/recording/stop?session_id=x");
  assert.equal((await mockRequest("/recording/library")).at(-1).id, recording.id);
  assert.equal((await mockRequest(`/recording/by-song/${MOCK_SONG_ID}`)).at(-1).id, recording.id);
  assert.equal(await mockRequest(`/recording/${recording.id}`, { method: "DELETE" }), null);
  assert.deepEqual(await mockRequest("/analysis/id/run"), { queued: true });
  assert.equal((await mockRequest("/analysis/id")).accuracy_percent, 82);

  assert.deepEqual(await mockRequest("/models/whisper"), []);
  assert.equal((await mockRequest("/models/whisper/base/download")).ok, true);
  assert.equal((await mockRequest("/diagnostics/ai-models")).ready, true);
  assert.equal((await mockRequest("/diagnostics/ai-models/download")).state, "downloading");
  assert.equal((await mockRequest("/cache/size")).bytes, 0);
  assert.ok((await mockRequest("/cache/free-space")).bytes);
  assert.equal((await mockRequest("/cache/clear")).ok, true);
  assert.equal((await mockRequest("/diagnostics/health")).status, "ok");
  assert.equal((await mockRequest("/diagnostics/pipeline")).status, "ok");
  assert.deepEqual(await mockRequest("/diagnostics/versions"), {});
  assert.deepEqual(await mockRequest("/diagnostics/errors"), []);
  assert.deepEqual(await mockRequest("/history"), []);
  assert.equal((await mockRequest("/about")).backend_version, "mock");

  const blob = await mockBlobRequest(`/songs/${MOCK_SONG_ID}/package`);
  assert.equal(blob.type, "application/zip");
  await assert.rejects(mockRequest("/missing", { method: "PUT" }), /not implemented/);
  await assert.rejects(mockBlobRequest("/missing", { method: "POST" }), /not implemented/);
  assert.equal(Object.isFrozen(api), true);
});
