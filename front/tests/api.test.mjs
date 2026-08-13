import assert from "node:assert/strict";
import { beforeEach, describe, test, vi } from "vitest";

import {
  createFileUrl,
  encodePathSegment,
  request,
  requestBlob
} from "../src/api/core.js";
import {
  clampNumber,
  normalizeBoolean,
  normalizeModel,
  normalizeNonNegativeNumber,
  normalizeRecording,
  normalizeSong,
  normalizeSongList,
  normalizeString
} from "../src/api/normalizers.js";
import { audioApi } from "../src/api/domains/audio.js";
import { modelsApi } from "../src/api/domains/models.js";
import { playerApi } from "../src/api/domains/player.js";
import { recordingsApi } from "../src/api/domains/recordings.js";
import { settingsApi } from "../src/api/domains/settings.js";
import { songsApi } from "../src/api/domains/songs.js";
import { systemApi } from "../src/api/domains/system.js";

const response = ({ body = "{}", json, ok = true, status = 200, statusText = "", url = "" } = {}) => ({
  ok,
  status,
  statusText,
  url,
  text: async () => body,
  json: async () => (json === undefined ? JSON.parse(body) : json),
  blob: async () => new Blob([body])
});

beforeEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = vi.fn(async () => response());
});

describe("API transport", () => {
  test("normalizes request paths, bodies and successful response kinds", async () => {
    globalThis.fetch
      .mockResolvedValueOnce(response({ body: '{"ok":true}', url: "http://api/value" }))
      .mockResolvedValueOnce(response({ status: 204, body: "" }))
      .mockResolvedValueOnce(response({ body: "" }))
      .mockResolvedValueOnce(response({ body: "blob" }));
    assert.deepEqual(await request("value", { method: "POST", body: "{}" }), { ok: true });
    const [, options] = globalThis.fetch.mock.calls[0];
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.equal(await request("/empty"), null);
    assert.equal(await request("/blank"), null);
    assert.equal((await requestBlob("blob")).size, 4);

    const headers = new Headers({ Accept: "application/json" });
    await request("headers", { headers, body: null });
    assert.deepEqual(globalThis.fetch.mock.calls.at(-1)[1].headers, { accept: "application/json" });
    await request("array", { headers: [["X-Test", "yes"]], body: new FormData() });
    assert.equal(globalThis.fetch.mock.calls.at(-1)[1].headers["X-Test"], "yes");
    await request("object", {
      headers: { "Content-Type": "text/plain" },
      body: "plain"
    });
    assert.deepEqual(globalThis.fetch.mock.calls.at(-1)[1].headers, {
      "Content-Type": "text/plain"
    });
  });

  test("reports HTTP, malformed JSON and missing fetch failures", async () => {
    globalThis.fetch.mockResolvedValueOnce(
      response({ ok: false, status: 422, json: { detail: "bad" }, url: "http://api/bad" })
    );
    await assert.rejects(request("bad"), (error) => error.message === "bad" && error.status === 422);
    globalThis.fetch.mockResolvedValueOnce(
      response({ ok: false, status: 500, statusText: "Failure", json: { detail: { code: 1 } } })
    );
    await assert.rejects(request("bad"), /\{"code":1\}/);
    globalThis.fetch.mockResolvedValueOnce({
      ...response({ ok: false, status: 503, statusText: "Offline" }),
      json: async () => {
        throw new Error("not json");
      }
    });
    await assert.rejects(request("bad"), /Offline/);
    globalThis.fetch.mockResolvedValueOnce(response({ body: "not-json", url: "bad-json" }));
    await assert.rejects(request("bad"), /JSON/);
    delete globalThis.fetch;
    await assert.rejects(request("bad"), /Fetch API/);
  });

  test("encodes identifiers and confines local file URLs", () => {
    assert.equal(encodePathSegment(" a/b "), "a%2Fb");
    assert.throws(() => encodePathSegment(" "), TypeError);
    assert.match(createFileUrl("local/file.wav"), /\/local\/file\.wav$/);
    assert.match(createFileUrl(""), /^http/);
    assert.throws(() => createFileUrl("https://remote/file"), TypeError);
  });
});

describe("API normalization", () => {
  test("normalizes primitives and malformed entities", () => {
    assert.equal(clampNumber("3", 0, 2), 2);
    assert.equal(clampNumber("x", 0, 2, 1), 1);
    assert.equal(normalizeString(null, "fallback"), "fallback");
    assert.equal(normalizeString("  ", "fallback"), "fallback");
    for (const value of [true, 1, "YES", "on"]) assert.equal(normalizeBoolean(value), true);
    for (const value of [false, 0, "NO", ""]) assert.equal(normalizeBoolean(value, true), false);
    assert.equal(normalizeBoolean(NaN, true), true);
    assert.equal(normalizeBoolean("maybe", true), true);
    assert.equal(normalizeBoolean({}, true), true);
    assert.equal(normalizeNonNegativeNumber(-1, 4), 4);
    assert.equal(normalizeNonNegativeNumber("2"), 2);
    assert.deepEqual(normalizeSongList(null), []);
    assert.equal(normalizeSong({ status: "UNKNOWN", progress_percent: 999 }).status, "pending");
    assert.equal(normalizeSong({ status: "DONE", error_message: " " }).error_message, null);
    assert.deepEqual(normalizeSongList([null]).map((song) => song.status), ["pending"]);
    assert.deepEqual(normalizeModel(null), { name: "", downloaded: false, selected: false, size: 0 });
    assert.equal(normalizeRecording({ duration_sec: -2 }).duration_sec, 0);
  });
});

describe("API domains", () => {
  test("routes audio, player and system operations", async () => {
    const calls = [
      audioApi.listAudioDevices(), audioApi.listAudioOutputDevices(), audioApi.listAsioDrivers(),
      audioApi.getAudioSettings(), audioApi.updateAudioSettings({ latency: 1 }),
      audioApi.startDirectMonitoring(), audioApi.stopDirectMonitoring(), audioApi.getSignalQuality(),
      playerApi.getSync("a/b"), playerApi.getTimeline("a"), playerApi.getPosition("a"),
      playerApi.seek("a", 2), playerApi.play("a"), playerApi.pause("a"), playerApi.stop("a"),
      systemApi.getCacheSize(), systemApi.getFreeSpace(), systemApi.clearCache(), systemApi.deleteTemp(),
      systemApi.optimizeSong("a"), systemApi.getHealth(), systemApi.getPipelineHealth(),
      systemApi.getAiModelsStatus(), systemApi.downloadAiModels(), systemApi.getVersions(),
      systemApi.getErrors(), systemApi.getHistory(), systemApi.getAbout()
    ];
    await Promise.all(calls);
    assert.equal(globalThis.fetch.mock.calls.length, calls.length);
    globalThis.fetch.mockRejectedValueOnce(new Error("closed"));
    assert.equal(await audioApi.releaseDirectMonitoring(), null);
  });

  test("routes model and recording operations and normalizes collections", async () => {
    globalThis.fetch.mockResolvedValueOnce(response({ body: '[{"name":" x ","size":-1}]' }));
    assert.deepEqual(await modelsApi.listWhisperModels(), [
      { name: "x", size: 0, downloaded: false, selected: false }
    ]);
    globalThis.fetch.mockResolvedValueOnce(response({ body: "null" }));
    assert.deepEqual(await modelsApi.listWhisperModels(), []);
    for (const call of [modelsApi.downloadModel("x"), modelsApi.deleteModel("x"), modelsApi.selectModel("x")]) await call;
    globalThis.fetch.mockResolvedValueOnce(response({ body: "{}" }));
    await recordingsApi.startRecording("song", 1, 0.8, 0.7, 0.1, 0.2, 0.3);
    await recordingsApi.pauseRecording("a/b");
    await recordingsApi.resumeRecording(null);
    await recordingsApi.stopRecording("id");
    globalThis.fetch.mockResolvedValueOnce(response({ body: '[{"id":1,"duration_sec":"2"}]' }));
    assert.equal((await recordingsApi.listRecordingsForSong("song"))[0].duration_sec, 2);
    globalThis.fetch.mockResolvedValueOnce(response({ body: "null" }));
    assert.deepEqual(await recordingsApi.listRecordingsForSong("song"), []);
    globalThis.fetch.mockResolvedValueOnce(response({ body: "null" }));
    assert.deepEqual(await recordingsApi.listRecordingLibrary(), []);
    await recordingsApi.getRecordingSettings();
    await recordingsApi.deleteRecording("id");
    assert.match(recordingsApi.getRecordingFileUrl("id"), /\/file$/);
    assert.match(recordingsApi.getPerformanceFileUrl("id"), /\/performance$/);
    await recordingsApi.runAnalysis("id");
    await recordingsApi.getAnalysis("id");
  });

  test("routes song CRUD, processing, editor and package operations", async () => {
    globalThis.fetch.mockResolvedValue(response({ body: "[]" }));
    assert.deepEqual(await songsApi.listSongs(), []);
    await songsApi.getSong("id");
    await songsApi.addSong(new Blob(["song"]), "Title");
    await songsApi.addSong(new Blob(["song"]));
    await songsApi.updateSong("id", { title: "x" });
    await songsApi.deleteSong("id");
    await songsApi.processSong("id");
    await songsApi.reprocessMelody("id");
    await songsApi.cancelProcessing("id");
    await songsApi.getStatus("id");
    await songsApi.getLog("id");
    await songsApi.getResult("id");
    await songsApi.getSongEditor("id");
    await songsApi.saveSongEditor("id", []);
    await songsApi.resetSongEditor("id");
    await songsApi.updateLyrics("id", "lyrics");
    assert.match(songsApi.getAudioTrackUrl("id", "vocals"), /vocals$/);
    await songsApi.exportSongPackage("id");
    await songsApi.importSongPackage(new Blob(["zip"]));
  });

  test("persists backend settings and UI preferences", async () => {
    globalThis.localStorage = {
      getItem: () => "dark",
      setItem: vi.fn()
    };
    globalThis.window = { localStorage: globalThis.localStorage };
    globalThis.fetch.mockResolvedValueOnce(response({ body: "{}" }));
    assert.equal((await settingsApi.getAppSettings()).theme, "dark");
    globalThis.fetch.mockResolvedValue(response({ body: '{"ok":true}' }));
    const updated = await settingsApi.updateAppSettings({ theme: "light", audio: true });
    assert.equal(updated.theme, "light");
    await settingsApi.updateAppSettings(null);
    await settingsApi.getUiPreferences();
    await settingsApi.updateUiPreferences("karaoke room", { radio: true });
  });
});
