import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test, vi } from "vitest";

let importId = 0;
const importApi = (name) =>
  import(/* @vite-ignore */ `../src/api/${name}.js?contract=${importId++}`);
const importDomain = (name) =>
  import(
    /* @vite-ignore */ `../src/api/domains/${name}.js?contract=${importId++}`
  );

const response = ({
  body = "{}",
  json,
  ok = true,
  status = 200,
  statusText = "",
  url = ""
} = {}) => ({
  ok,
  status,
  statusText,
  url,
  text: async () => body,
  json: async () => (json === undefined ? JSON.parse(body) : json),
  blob: async () => new Blob([body])
});

async function assertRequest(invoke, expected) {
  const result = await invoke();
  const [url, options] = globalThis.fetch.mock.calls.at(-1);
  const parsedUrl = new URL(url);
  assert.equal(`${parsedUrl.pathname}${parsedUrl.search}`, expected.path);
  assert.equal(options.method, expected.method);
  assert.equal(options.keepalive, expected.keepalive);
  if (Object.hasOwn(expected, "body")) {
    assert.deepEqual(JSON.parse(options.body), expected.body);
    assert.equal(options.headers["Content-Type"], "application/json");
  } else assert.equal(options.body, undefined);
  return result;
}

beforeEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = vi.fn(async () => response());
});
afterEach(() => vi.unstubAllEnvs());

describe("API transport", () => {
  test("normalizes request paths, bodies and successful response kinds", async () => {
    const { request, requestBlob } = await importApi("core");
    globalThis.fetch
      .mockResolvedValueOnce(
        response({ body: '{"ok":true}', url: "http://api/value" })
      )
      .mockResolvedValueOnce(
        response({ status: 204, body: '{"ignored":true}' })
      )
      .mockResolvedValueOnce(response({ body: "" }))
      .mockResolvedValueOnce(response({ body: "blob" }));
    assert.deepEqual(await request("value", { method: "POST", body: "{}" }), {
      ok: true
    });
    let [url, options] = globalThis.fetch.mock.calls[0];
    assert.equal(new URL(url).pathname, "/value");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.equal(await request("/empty"), null);
    assert.equal(new URL(globalThis.fetch.mock.calls[1][0]).pathname, "/empty");
    assert.equal(await request("/blank"), null);
    assert.equal((await requestBlob("blob")).size, 4);

    const headers = new Headers({ Accept: "application/json" });
    await request("headers", { headers, body: null });
    assert.deepEqual(globalThis.fetch.mock.calls.at(-1)[1].headers, {
      accept: "application/json"
    });
    await request("array", {
      headers: [["X-Test", "yes"]],
      body: new FormData()
    });
    assert.equal(
      globalThis.fetch.mock.calls.at(-1)[1].headers["X-Test"],
      "yes"
    );
    await request("form", { body: new FormData() });
    assert.equal(globalThis.fetch.mock.calls.at(-1)[1].headers, undefined);
    await request("object", {
      headers: { "Content-Type": "text/plain" },
      body: "plain"
    });
    assert.deepEqual(globalThis.fetch.mock.calls.at(-1)[1].headers, {
      "Content-Type": "text/plain"
    });
    await request("accept", {
      headers: { Accept: "application/json" },
      body: "{}"
    });
    assert.deepEqual(globalThis.fetch.mock.calls.at(-1)[1].headers, {
      Accept: "application/json",
      "Content-Type": "application/json"
    });
    await request("null", { body: null });
    assert.equal(globalThis.fetch.mock.calls.at(-1)[1].headers, undefined);
    await request("binary", { body: new Uint8Array([1]) });
    assert.deepEqual(globalThis.fetch.mock.calls.at(-1)[1].headers, {});

    const FormDataCtor = globalThis.FormData;
    globalThis.FormData = undefined;
    try {
      await request("without-form-data", { body: "{}" });
    } finally {
      globalThis.FormData = FormDataCtor;
    }
    [url, options] = globalThis.fetch.mock.calls.at(-1);
    assert.equal(new URL(url).pathname, "/without-form-data");
    assert.equal(options.headers["Content-Type"], "application/json");
  });

  test("reports HTTP, malformed JSON and missing fetch failures", async () => {
    const { request } = await importApi("core");
    globalThis.fetch.mockResolvedValueOnce(
      response({
        ok: false,
        status: 422,
        json: { detail: "bad" },
        url: "http://api/bad"
      })
    );
    await assert.rejects(
      request("bad"),
      (error) =>
        error.message === "bad" &&
        error.status === 422 &&
        error.url === "http://api/bad"
    );
    globalThis.fetch.mockResolvedValueOnce(
      response({
        ok: false,
        status: 500,
        statusText: "Failure",
        json: { detail: { code: 1 } }
      })
    );
    await assert.rejects(request("bad"), /\{"code":1\}/);
    globalThis.fetch.mockResolvedValueOnce({
      ...response({ ok: false, status: 503, statusText: "Offline" }),
      json: async () => {
        throw new Error("not json");
      }
    });
    await assert.rejects(
      request("bad"),
      (error) =>
        error.message === "Offline" && error.url === "http://127.0.0.1:8000/bad"
    );
    globalThis.fetch.mockResolvedValueOnce({
      ...response({ ok: false, status: 418 }),
      json: async () => {
        throw new Error("not json");
      }
    });
    await assert.rejects(request("teapot"), /HTTP 418/);
    globalThis.fetch.mockResolvedValueOnce(
      response({ body: "not-json", url: "bad-json" })
    );
    await assert.rejects(request("bad"), /JSON/);
    globalThis.fetch.mockResolvedValueOnce(
      response({ ok: false, status: 400, json: { message: "plain" } })
    );
    await assert.rejects(request(null), /plain/);
    assert.equal(new URL(globalThis.fetch.mock.calls.at(-1)[0]).pathname, "/");
    globalThis.fetch.mockResolvedValueOnce(response({ body: "bad" }));
    await assert.rejects(request("fallback-path"), /fallback-path/);
    delete globalThis.fetch;
    await assert.rejects(request("bad"), /Fetch API/);
  });

  test("aborts stalled backend requests at the configured deadline", async () => {
    vi.useFakeTimers();
    const { request } = await importApi("core");
    globalThis.fetch.mockImplementationOnce((_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      })
    );
    const pending = request("stalled", { timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    await assert.rejects(pending, (error) => error.name === "TimeoutError");
    vi.useRealTimers();
  });

  test("encodes identifiers and confines local file URLs", () => {
    return importApi("core").then(({ createFileUrl, encodePathSegment }) => {
      assert.equal(encodePathSegment(" a/b "), "a%2Fb");
      assert.throws(
        () => encodePathSegment(" "),
        (error) => error instanceof TypeError && error.message.length > 0
      );
      assert.throws(() => encodePathSegment(null), TypeError);
      assert.match(createFileUrl("local/file.wav"), /\/local\/file\.wav$/);
      assert.equal(
        new URL(createFileUrl(" /local/file.wav ")).pathname,
        "/local/file.wav"
      );
      assert.equal(createFileUrl(""), "http://127.0.0.1:8000");
      assert.equal(createFileUrl(null), "http://127.0.0.1:8000");
      assert.match(createFileUrl("folder/http:file"), /folder\/http:file$/);
      assert.throws(() => createFileUrl("x1:remote"), TypeError);
      assert.throws(
        () => createFileUrl("https://remote/file"),
        (error) => error instanceof TypeError && error.message.length > 0
      );
    });
  });

  test("routes every transport kind through the optional mock API", async () => {
    vi.stubEnv("VITE_USE_MOCK_API", "true");
    const mockCore = await importApi("core");
    assert.equal(mockCore.MOCK_API_ENABLED, true);
    globalThis.fetch.mockClear();
    assert.ok(Array.isArray(await mockCore.request("/songs")));
    assert.ok((await mockCore.requestBlob("/songs/demo/package")).size > 0);
    assert.match(mockCore.createFileUrl("/audio/file"), /^data:audio\/wav/);
    assert.equal(globalThis.fetch.mock.calls.length, 0);
  });
});

describe("API normalization", () => {
  test("normalizes primitives and malformed entities", async () => {
    const {
      clampNumber,
      normalizeBoolean,
      normalizeModel,
      normalizeNonNegativeNumber,
      normalizeRecording,
      normalizeSong,
      normalizeSongList,
      normalizeString
    } = await importApi("normalizers");
    assert.equal(clampNumber("3", 0, 2), 2);
    assert.equal(clampNumber("x", 0, 2, 1), 1);
    assert.equal(normalizeString(null, "fallback"), "fallback");
    assert.equal(normalizeString("  ", "fallback"), "fallback");
    for (const value of [true, 1, "YES", "on"])
      assert.equal(normalizeBoolean(value), true);
    for (const value of [false, 0, "false", "0", "NO", "off", ""])
      assert.equal(normalizeBoolean(value, true), false);
    assert.equal(normalizeBoolean("  true  "), true);
    assert.equal(normalizeBoolean(NaN, true), true);
    assert.equal(normalizeBoolean("maybe", true), true);
    assert.equal(normalizeBoolean({}, true), true);
    assert.equal(normalizeNonNegativeNumber(-1, 4), 4);
    assert.equal(normalizeNonNegativeNumber(0, 4), 0);
    assert.equal(normalizeNonNegativeNumber("2"), 2);
    assert.deepEqual(normalizeSongList(null), []);
    assert.equal(
      normalizeSong({ status: "UNKNOWN", progress_percent: 999 }).status,
      "pending"
    );
    assert.equal(
      normalizeSong({ status: "DONE", error_message: " " }).error_message,
      null
    );
    assert.deepEqual(
      normalizeSongList([null]).map((song) => song.status),
      ["pending"]
    );
    for (const status of [
      "pending",
      "queued",
      "processing",
      "cancelling",
      "cancelled",
      "done",
      "error"
    ])
      assert.equal(normalizeSong({ status }).status, status);
    assert.equal(Object.hasOwn(normalizeSong("x"), "0"), false);
    assert.deepEqual(normalizeModel(null), {
      name: "",
      downloaded: false,
      selected: false,
      size: 0
    });
    assert.equal(Object.hasOwn(normalizeModel("x"), "0"), false);
    assert.equal(normalizeRecording({ duration_sec: -2 }).duration_sec, 0);
    assert.deepEqual(normalizeRecording(null), {
      id: "",
      song_id: "",
      duration_sec: 0
    });
    assert.equal(Object.hasOwn(normalizeRecording("x"), "0"), false);
  });
});

describe("API domains", () => {
  test("routes audio, player and system operations", async () => {
    const [{ audioApi }, { playerApi }, { systemApi }] = await Promise.all([
      importDomain("audio"),
      importDomain("player"),
      importDomain("system")
    ]);
    const operations = [
      [audioApi.listAudioDevices, "/audio/devices"],
      [audioApi.listAudioOutputDevices, "/audio/output-devices"],
      [audioApi.listAsioDrivers, "/audio/asio-drivers"],
      [audioApi.getAudioSettings, "/audio/settings"],
      [
        () => audioApi.updateAudioSettings({ latency: 1 }),
        "/audio/settings",
        "POST",
        { latency: 1 }
      ],
      [audioApi.startDirectMonitoring, "/audio/direct-monitor/start", "POST"],
      [audioApi.stopDirectMonitoring, "/audio/direct-monitor/stop", "POST"],
      [audioApi.getSignalQuality, "/audio/signal-quality"],
      [() => playerApi.getSync("a/b"), "/player/a%2Fb/sync"],
      [() => playerApi.getTimeline("a/b"), "/player/a%2Fb/timeline"],
      [() => playerApi.getPosition("a/b"), "/player/a%2Fb/position"],
      [
        () => playerApi.seek("a/b", 2.5),
        "/player/a%2Fb/seek",
        "POST",
        { position_sec: 2.5 }
      ],
      [() => playerApi.play("a/b"), "/player/a%2Fb/resume", "POST"],
      [() => playerApi.pause("a/b"), "/player/a%2Fb/pause", "POST"],
      [() => playerApi.stop("a/b"), "/player/a%2Fb/stop", "POST"],
      [systemApi.getCacheSize, "/cache/size"],
      [systemApi.getFreeSpace, "/cache/free-space"],
      [systemApi.clearCache, "/cache/clear", "POST"],
      [systemApi.deleteTemp, "/cache/temp", "DELETE"],
      [() => systemApi.optimizeSong("a/b"), "/cache/optimize/a%2Fb", "POST"],
      [systemApi.getHealth, "/diagnostics/health"],
      [systemApi.getPipelineHealth, "/diagnostics/pipeline"],
      [systemApi.getAiModelsStatus, "/diagnostics/ai-models"],
      [systemApi.downloadAiModels, "/diagnostics/ai-models/download", "POST"],
      [systemApi.getVersions, "/diagnostics/versions"],
      [systemApi.getErrors, "/diagnostics/errors"],
      [systemApi.getHistory, "/history"],
      [systemApi.getAbout, "/about"]
    ];
    for (const [invoke, path, method, body] of operations)
      await assertRequest(invoke, {
        path,
        method,
        ...(body === undefined ? {} : { body })
      });

    await assertRequest(audioApi.releaseDirectMonitoring, {
      path: "/audio/direct-monitor/stop",
      method: "POST",
      keepalive: true
    });
    globalThis.fetch.mockRejectedValueOnce(new Error("closed"));
    assert.equal(await audioApi.releaseDirectMonitoring(), null);
  });

  test("routes model and recording operations and normalizes collections", async () => {
    const [{ modelsApi }, { recordingsApi }] = await Promise.all([
      importDomain("models"),
      importDomain("recordings")
    ]);
    globalThis.fetch.mockResolvedValueOnce(
      response({ body: '[{"name":" x ","size":-1}]' })
    );
    assert.deepEqual(await modelsApi.listWhisperModels(), [
      { name: "x", size: 0, downloaded: false, selected: false }
    ]);
    assert.equal(
      new URL(globalThis.fetch.mock.calls.at(-1)[0]).pathname,
      "/models/whisper"
    );
    globalThis.fetch.mockResolvedValueOnce(response({ body: "null" }));
    assert.deepEqual(await modelsApi.listWhisperModels(), []);
    assert.equal(
      new URL(globalThis.fetch.mock.calls.at(-1)[0]).pathname,
      "/models/whisper"
    );
    for (const [invoke, path, method] of [
      [
        () => modelsApi.downloadModel("a/b"),
        "/models/whisper/a%2Fb/download",
        "POST"
      ],
      [() => modelsApi.deleteModel("a/b"), "/models/whisper/a%2Fb", "DELETE"],
      [
        () => modelsApi.selectModel("a/b"),
        "/models/whisper/a%2Fb/select",
        "POST"
      ]
    ])
      await assertRequest(invoke, { path, method });

    await assertRequest(() => recordingsApi.startRecording("song"), {
      path: "/recording/start",
      method: "POST",
      body: {
        song_id: "song",
        position_sec: 0,
        music_volume: 1,
        microphone_volume: 1,
        reverb: 0,
        echo: 0,
        delay: 0
      }
    });
    await assertRequest(
      () => recordingsApi.startRecording("song", 1, 0.8, 0.7, 0.1, 0.2, 0.3),
      {
        path: "/recording/start",
        method: "POST",
        body: {
          song_id: "song",
          position_sec: 1,
          music_volume: 0.8,
          microphone_volume: 0.7,
          reverb: 0.1,
          echo: 0.2,
          delay: 0.3
        }
      }
    );
    for (const [invoke, path] of [
      [
        () => recordingsApi.pauseRecording("a/b ?"),
        "/recording/pause?session_id=a%2Fb%20%3F"
      ],
      [
        () => recordingsApi.pauseRecording(null),
        "/recording/pause?session_id="
      ],
      [
        () => recordingsApi.resumeRecording("a/b ?"),
        "/recording/resume?session_id=a%2Fb%20%3F"
      ],
      [
        () => recordingsApi.resumeRecording(null),
        "/recording/resume?session_id="
      ],
      [
        () => recordingsApi.stopRecording("a/b ?"),
        "/recording/stop?session_id=a%2Fb%20%3F"
      ],
      [() => recordingsApi.stopRecording(null), "/recording/stop?session_id="]
    ])
      await assertRequest(invoke, { path, method: "POST" });
    globalThis.fetch.mockResolvedValueOnce(
      response({ body: '[{"id":1,"duration_sec":"2"}]' })
    );
    assert.equal(
      (await recordingsApi.listRecordingsForSong("song"))[0].duration_sec,
      2
    );
    assert.equal(
      new URL(globalThis.fetch.mock.calls.at(-1)[0]).pathname,
      "/recording/by-song/song"
    );
    globalThis.fetch.mockResolvedValueOnce(response({ body: "null" }));
    assert.deepEqual(await recordingsApi.listRecordingsForSong("song"), []);
    assert.equal(
      new URL(globalThis.fetch.mock.calls.at(-1)[0]).pathname,
      "/recording/by-song/song"
    );
    globalThis.fetch.mockResolvedValueOnce(response({ body: "null" }));
    assert.deepEqual(await recordingsApi.listRecordingLibrary(), []);
    assert.equal(
      new URL(globalThis.fetch.mock.calls.at(-1)[0]).pathname,
      "/recording/library"
    );
    globalThis.fetch.mockResolvedValueOnce(
      response({ body: '[{"id":"library"}]' })
    );
    assert.equal((await recordingsApi.listRecordingLibrary())[0].id, "library");
    assert.equal(
      new URL(globalThis.fetch.mock.calls.at(-1)[0]).pathname,
      "/recording/library"
    );
    await assertRequest(recordingsApi.getRecordingSettings, {
      path: "/recording/settings"
    });
    await assertRequest(() => recordingsApi.deleteRecording("a/b"), {
      path: "/recording/a%2Fb",
      method: "DELETE"
    });
    assert.equal(
      new URL(recordingsApi.getRecordingFileUrl("a/b")).pathname,
      "/recording/a%2Fb/file"
    );
    assert.equal(
      new URL(recordingsApi.getPerformanceFileUrl("a/b")).pathname,
      "/recording/a%2Fb/performance"
    );
    await assertRequest(() => recordingsApi.runAnalysis("a/b"), {
      path: "/analysis/a%2Fb/run",
      method: "POST"
    });
    await assertRequest(() => recordingsApi.getAnalysis("a/b"), {
      path: "/analysis/a%2Fb"
    });
  });

  test("routes song reads and normalizes their public results", async () => {
    const { songsApi } = await importDomain("songs");
    globalThis.fetch
      .mockResolvedValueOnce(
        response({
          body: '[{"id":1,"title":" Song ","status":"DONE","progress_percent":120}]'
        })
      )
      .mockResolvedValueOnce(
        response({
          body: '{"id":"a/b","title":" ","status":"UNKNOWN","progress_percent":-1}'
        })
      );

    assert.deepEqual(await songsApi.listSongs(), [
      {
        id: "1",
        title: "Song",
        status: "done",
        progress_percent: 100,
        progress_step: "",
        error_message: null
      }
    ]);
    assert.equal(new URL(globalThis.fetch.mock.calls[0][0]).pathname, "/songs");

    assert.deepEqual(await songsApi.getSong(" a/b "), {
      id: "a/b",
      title: "Без назви",
      status: "pending",
      progress_percent: 0,
      progress_step: "",
      error_message: null
    });
    assert.equal(
      new URL(globalThis.fetch.mock.calls[1][0]).pathname,
      "/songs/a%2Fb"
    );
  });

  test("routes song mutations with exact methods and JSON contracts", async () => {
    const { songsApi } = await importDomain("songs");
    const id = "a/b";
    const operations = [
      [
        () => songsApi.updateSong(id, { title: "x" }),
        "PATCH",
        "/songs/a%2Fb",
        { title: "x" }
      ],
      [() => songsApi.deleteSong(id), "DELETE", "/songs/a%2Fb"],
      [() => songsApi.processSong(id), "POST", "/songs/a%2Fb/process"],
      [() => songsApi.reprocessMelody(id), "POST", "/songs/a%2Fb/reprocess"],
      [() => songsApi.cancelProcessing(id), "POST", "/songs/a%2Fb/cancel"],
      [() => songsApi.getStatus(id), undefined, "/songs/a%2Fb/status"],
      [() => songsApi.getLog(id), undefined, "/songs/a%2Fb/log"],
      [() => songsApi.getResult(id), undefined, "/songs/a%2Fb/result"],
      [() => songsApi.getSongEditor(id), undefined, "/songs/a%2Fb/editor"],
      [
        () => songsApi.saveSongEditor(id, [{ pitch: 60 }]),
        "PUT",
        "/songs/a%2Fb/editor",
        { notes: [{ pitch: 60 }] }
      ],
      [() => songsApi.resetSongEditor(id), "POST", "/songs/a%2Fb/editor/reset"],
      [
        () => songsApi.updateLyrics(id, "lyrics"),
        "PUT",
        "/songs/a%2Fb/lyrics",
        { lyrics: "lyrics" }
      ]
    ];

    for (const [invoke, method, path, json] of operations) {
      await invoke();
      const [url, options] = globalThis.fetch.mock.calls.at(-1);
      assert.equal(new URL(url).pathname, path);
      assert.equal(options.method, method);
      if (json === undefined) assert.equal(options.body, undefined);
      else {
        assert.deepEqual(JSON.parse(options.body), json);
        assert.equal(options.headers["Content-Type"], "application/json");
      }
    }
  });

  test("uploads, exports and creates audio URLs with exact song package contracts", async () => {
    const { songsApi } = await importDomain("songs");
    const song = new Blob(["song"]);
    await songsApi.addSong(song, "Title");
    let [url, options] = globalThis.fetch.mock.calls.at(-1);
    assert.equal(new URL(url).pathname, "/songs");
    assert.equal(options.method, "POST");
    assert.equal(await options.body.get("file").text(), "song");
    assert.equal(options.body.get("title"), "Title");

    await songsApi.addSong(song);
    [, options] = globalThis.fetch.mock.calls.at(-1);
    assert.deepEqual([...options.body.keys()], ["file"]);

    assert.equal(
      new URL(songsApi.getAudioTrackUrl("a/b", "lead vocal")).pathname,
      "/songs/a%2Fb/audio/lead%20vocal"
    );

    globalThis.fetch.mockResolvedValueOnce(response({ body: "package" }));
    assert.equal(
      await (await songsApi.exportSongPackage("a/b")).text(),
      "package"
    );
    [url, options] = globalThis.fetch.mock.calls.at(-1);
    assert.equal(new URL(url).pathname, "/songs/a%2Fb/package");
    assert.equal(options.method, undefined);

    const archive = new Blob(["zip"]);
    await songsApi.importSongPackage(archive);
    [url, options] = globalThis.fetch.mock.calls.at(-1);
    assert.equal(new URL(url).pathname, "/songs/package/import");
    assert.equal(options.method, "POST");
    assert.equal(options.body.get("file").name, "song.karaoke.zip");
    assert.equal(await options.body.get("file").text(), "zip");

    await songsApi.importSongPackage(archive, "custom.zip");
    [, options] = globalThis.fetch.mock.calls.at(-1);
    assert.equal(options.body.get("file").name, "custom.zip");
  });

  test("persists backend settings and UI preferences", async () => {
    const { settingsApi } = await importDomain("settings");
    globalThis.localStorage = {
      getItem: () => "dark",
      setItem: vi.fn()
    };
    globalThis.window = { localStorage: globalThis.localStorage };
    globalThis.fetch.mockResolvedValueOnce(response({ body: "{}" }));
    assert.equal((await settingsApi.getAppSettings()).theme, "dark");
    assert.equal(
      new URL(globalThis.fetch.mock.calls.at(-1)[0]).pathname,
      "/settings"
    );
    globalThis.fetch.mockResolvedValue(response({ body: '{"ok":true}' }));
    const updated = await settingsApi.updateAppSettings({
      theme: "light",
      audio: true
    });
    assert.deepEqual(updated, { ok: true, theme: "light" });
    assert.equal(
      globalThis.localStorage.setItem.mock.calls[0][0],
      "karaoke-theme"
    );
    assert.equal(globalThis.localStorage.setItem.mock.calls[0][1], "light");
    let [, options] = globalThis.fetch.mock.calls.at(-1);
    assert.equal(options.method, "PATCH");
    assert.deepEqual(JSON.parse(options.body), { audio: true, theme: "light" });

    await assertRequest(() => settingsApi.updateAppSettings(null), {
      path: "/settings",
      method: "PATCH",
      body: {}
    });
    await assertRequest(settingsApi.getUiPreferences, { path: "/preferences" });
    await assertRequest(
      () => settingsApi.updateUiPreferences("karaoke room", { radio: true }),
      {
        path: "/preferences/karaoke%20room",
        method: "PATCH",
        body: { radio: true }
      }
    );
  });
});
