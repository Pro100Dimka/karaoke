import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const require = createRequire(import.meta.url);
const runtimeConfigPath = require.resolve("../electron/runtime-config.cjs");
const preloadPath = require.resolve("../electron/preload.cjs");
const securityPath = require.resolve("../electron/security.cjs");
const songFoldersPath = require.resolve("../electron/song-folders.cjs");
const nodeModule = require("node:module");
const security = require("../electron/security.cjs");
const songFolders = require("../electron/song-folders.cjs");

const originalEnvironment = { ...process.env };

function loadRuntimeConfig(environment = {}) {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("KARAOKE_")) delete process.env[name];
  }
  Object.assign(process.env, environment);
  delete require.cache[runtimeConfigPath];
  // Runtime configuration is intentionally evaluated from the current process environment.
  // eslint-disable-next-line import/no-dynamic-require
  return require(runtimeConfigPath);
}

function directory(name, isDirectory = true) {
  return { name, isDirectory: () => isDirectory };
}

afterEach(() => {
  for (const name of Object.keys(process.env)) delete process.env[name];
  Object.assign(process.env, originalEnvironment);
  delete require.cache[runtimeConfigPath];
});

describe("Electron runtime configuration", () => {
  test("uses immutable loopback defaults", () => {
    const config = loadRuntimeConfig();

    expect(config).toEqual({
      BACKEND_URL: "http://127.0.0.1:8000",
      DEV_RENDERER_ORIGIN: "http://127.0.0.1:5173",
      BACKEND_HOST: "127.0.0.1",
      BACKEND_PORT: 8000,
      BACKEND_REQUEST_TIMEOUT_MS: 1200,
      BACKEND_RESTART_BASE_DELAY_MS: 1200,
      BACKEND_RESTART_MAX_DELAY_MS: 30000,
      BACKEND_STOP_GRACE_MS: 550
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  test("normalizes supported loopback URLs and positive integer overrides", () => {
    const config = loadRuntimeConfig({
      KARAOKE_BACKEND_URL: " http://[::1]:8001/api?ignored=yes ",
      KARAOKE_RENDERER_ORIGIN: "http://[::1]:6000/path",
      KARAOKE_BACKEND_REQUEST_TIMEOUT_MS: "1",
      KARAOKE_BACKEND_RESTART_BASE_DELAY_MS: "2",
      KARAOKE_BACKEND_RESTART_MAX_DELAY_MS: "3",
      KARAOKE_BACKEND_STOP_GRACE_MS: "4"
    });

    expect(config).toMatchObject({
      BACKEND_URL: "http://[::1]:8001",
      DEV_RENDERER_ORIGIN: "http://[::1]:6000",
      BACKEND_HOST: "::1",
      BACKEND_PORT: 8001,
      BACKEND_REQUEST_TIMEOUT_MS: 1,
      BACKEND_RESTART_BASE_DELAY_MS: 2,
      BACKEND_RESTART_MAX_DELAY_MS: 3,
      BACKEND_STOP_GRACE_MS: 4
    });
  });

  test("accepts localhost and preserves the setting name in validation errors", () => {
    expect(
      loadRuntimeConfig({ KARAOKE_BACKEND_URL: "http://localhost:9000" })
    ).toMatchObject({
      BACKEND_URL: "http://localhost:9000",
      BACKEND_HOST: "localhost",
      BACKEND_PORT: 9000
    });
    expect(() => loadRuntimeConfig({ KARAOKE_BACKEND_STOP_GRACE_MS: "invalid" })
    ).toThrow("KARAOKE_BACKEND_STOP_GRACE_MS must be a positive integer");
  });

  test("trims Unicode whitespace around configured URLs", () => {
    expect(
      loadRuntimeConfig({
        KARAOKE_BACKEND_URL: "\u00a0http://localhost:9001\u00a0"
      }).BACKEND_URL
    ).toBe("http://localhost:9001");
  });

  test.each([
    ["KARAOKE_BACKEND_URL", "not a URL", "must be a valid URL"],
    [
      "KARAOKE_BACKEND_URL",
      "https://127.0.0.1",
      "must use HTTP on a loopback host"
    ],
    [
      "KARAOKE_RENDERER_ORIGIN",
      "http://example.test",
      "must use HTTP on a loopback host"
    ],
    ["KARAOKE_BACKEND_REQUEST_TIMEOUT_MS", "0", "must be a positive integer"],
    [ "KARAOKE_BACKEND_RESTART_BASE_DELAY_MS", "-1", "must be a positive integer" ],
    [ "KARAOKE_BACKEND_RESTART_MAX_DELAY_MS", "1.5", "must be a positive integer" ],
    ["KARAOKE_BACKEND_STOP_GRACE_MS", "Infinity", "must be a positive integer"]
  ])("rejects invalid %s", (name, value, suffix) => {
    expect(() => loadRuntimeConfig({ [name]: value })).toThrow(
      `${name} ${suffix}`
    );
  });

  test("uses defaults for empty numeric overrides", () => {
    expect( loadRuntimeConfig({ KARAOKE_BACKEND_STOP_GRACE_MS: "" }) .BACKEND_STOP_GRACE_MS
    ).toBe(550);
  });
});

describe("renderer and permission security", () => {
  const packagedIndexUrl = security.getPackagedRendererUrl( path.resolve("dist/index.html")
  );
  const packaged = { isDev: false, packagedIndexUrl };
  const development = {
    isDev: true,
    devOrigin: "http://127.0.0.1:5173",
    packagedIndexUrl
  };

  test("exports only the audited security boundary", () => {
    delete require.cache[securityPath];
    // eslint-disable-next-line import/no-dynamic-require
    expect(Object.keys(require(securityPath)).sort()).toEqual([
      "getPackagedRendererUrl",
      "isAllowedPermissionRequest",
      "isAllowedRendererUrl",
      "isTrustedIpcEvent",
      "registerTrustedIpc"
    ]);
  });

  test("allows only the configured development origin", () => {
    expect(
      security.isAllowedRendererUrl("http://127.0.0.1:5173/room#x", development)
    ).toBe(true);
    expect(
      security.isAllowedRendererUrl("http://localhost:5173", development)
    ).toBe(false);
    expect(security.isAllowedRendererUrl("invalid", development)).toBe(false);
  });

  test("allows only the packaged index and its hash routes", () => {
    expect( security.getPackagedRendererUrl(path.resolve("another/index.html"))
    ).toBe(new URL(`file:///${path.resolve("another/index.html")}`).href);
    expect(security.isAllowedRendererUrl(packagedIndexUrl, packaged)).toBe( true
    );
    expect(
      security.isAllowedRendererUrl(`${packagedIndexUrl}#/karaoke`, packaged)
    ).toBe(true);
    expect(
      security.isAllowedRendererUrl(`${packagedIndexUrl}?unsafe=1`, packaged)
    ).toBe(false);
    expect(
      security.isAllowedRendererUrl("https://example.test", packaged)
    ).toBe(false);
    expect(
      security.isAllowedRendererUrl("https://example.test", {
        isDev: false,
        packagedIndexUrl: "https://example.test/"
      })
    ).toBe(false);
  });

  test.each([
    [undefined, true],
    [[], true],
    [["audio"], true],
    [["audio", "audio"], true],
    [["video"], false],
    [["audio", "video"], false]
  ])(
    "applies the audio-only media permission contract",
    (mediaTypes, allowed) => {
      const webContents = { isDestroyed: () => false };
      expect(
        security.isAllowedPermissionRequest({
          permission: "media",
          requestUrl: `${packagedIndexUrl}#/karaoke`,
          mediaTypes,
          webContents,
          expectedWebContents: webContents,
          rendererOptions: packaged
        })
      ).toBe(allowed);
    }
  );

  test("rejects unrelated, destroyed, foreign, and untrusted permission requests", () => {
    const expectedWebContents = { isDestroyed: () => false };
    const base = {
      permission: "media",
      requestUrl: packagedIndexUrl,
      mediaTypes: ["audio"],
      webContents: expectedWebContents,
      expectedWebContents,
      rendererOptions: packaged
    };

    expect( security.isAllowedPermissionRequest({ ...base, permission: "camera" })
    ).toBe(false);
    expect( security.isAllowedPermissionRequest({ ...base, webContents: {} })
    ).toBe(false);
    expect(
      security.isAllowedPermissionRequest({
        ...base,
        expectedWebContents: { isDestroyed: () => true }
      })
    ).toBe(false);
    expect( security.isAllowedPermissionRequest({ ...base, expectedWebContents: undefined })
    ).toBe(false);
    expect(
      security.isAllowedPermissionRequest({
        ...base,
        mediaTypes: ["video"],
        webContents: undefined,
        expectedWebContents: undefined
      })
    ).toBe(false);
    expect(security.isTrustedIpcEvent(undefined, expectedWebContents)).toBe( false
    );
    expect(
      security.isAllowedPermissionRequest({
        ...base,
        requestUrl: "file:///elsewhere/index.html"
      })
    ).toBe(false);
  });

  test("registers a dynamic trusted IPC boundary and forwards values", async () => {
    const callbacks = new Map();
    const ipcMain = { handle: vi.fn((channel, callback) => callbacks.set(channel, callback)) };
    const handler = vi.fn((left, right) => left + right);
    let expectedWebContents = { isDestroyed: () => false };

    security.registerTrustedIpc( ipcMain, "test:add", () => expectedWebContents, handler
    );
    const callback = callbacks.get("test:add");

    expect(callback({ sender: expectedWebContents }, 2, 3)).toBe(5);
    expect(handler).toHaveBeenCalledWith(2, 3);
    expect(() => callback({ sender: {} }, 1, 1)).toThrow( "Rejected IPC request: test:add"
    );
    expectedWebContents = { isDestroyed: () => true };
    expect(() => callback({ sender: expectedWebContents }, 1, 1)).toThrow(
      "Rejected IPC request: test:add"
    );
    expectedWebContents = null;
    expect(() => callback({ sender: null }, 1, 1)).toThrow( "Rejected IPC request: test:add"
    );
  });
});

describe("song folder matching", () => {
  test("exports only normalization and safe matching", () => {
    delete require.cache[songFoldersPath];
    // eslint-disable-next-line import/no-dynamic-require
    expect(Object.keys(require(songFoldersPath)).sort()).toEqual([
      "findMatchingSongFolder",
      "normalizeFolderName"
    ]);
  });

  test.each([
    [" 31-я весна ", "31явесна"],
    ["БОЛЬШОЙ!", "большой"],
    ["Ёлка_2026", "ёлка2026"],
    [null, ""]
  ])("normalizes %j", (input, output) => {
    expect(songFolders.normalizeFolderName(input)).toBe(output);
  });

  test("prefers an exact normalized directory match", () => {
    const expected = directory("31-я весна");
    expect(
      songFolders.findMatchingSongFolder(
        [directory("31-я весна (live)"), expected, directory("file", false)],
        [null, "31 Я ВЕСНА"]
      )
    ).toBe(expected);
  });

  test("returns a unique partial match but rejects ambiguity", () => {
    const live = directory("31-я весна live");
    expect(songFolders.findMatchingSongFolder([live], ["31-я весна"])).toBe( live
    );
    expect(
      songFolders.findMatchingSongFolder( [live, directory("31-я весна acoustic")], ["31-я весна"]
      )
    ).toBeNull();
    expect( songFolders.findMatchingSongFolder([directory("весна")], ["весна live"]) .name
    ).toBe("весна");
    expect(
      songFolders.findMatchingSongFolder(
        [directory("весна live"), directory("другая песня")],
        ["нет совпадения", "весна"]
      ).name
    ).toBe("весна live");
    expect( songFolders.findMatchingSongFolder([directory("unrelated")], ["missing"])
    ).toBeNull();
  });

  test("ignores invalid requests, files, and empty directory names", () => {
    expect( songFolders.findMatchingSongFolder([directory("real")], [null, "---"])
    ).toBeNull();
    expect(
      songFolders.findMatchingSongFolder(
        [null, {}, directory("song", false), directory("---")],
        ["song"]
      )
    ).toBeNull();
  });
});

describe("preload bridge", () => {
  function runPreload(arguments_ = []) {
    const invoke = vi.fn((...values) => values);
    const exposeInMainWorld = vi.fn();
    const originalArguments = process.argv;
    // Loading through Node's CJS loader keeps coverage attributable while replacing
    // only Electron's process-bound bridge with this local contract fake.
    // eslint-disable-next-line no-underscore-dangle
    const originalLoad = nodeModule._load;
    // eslint-disable-next-line no-underscore-dangle
    nodeModule._load = function load(specifier, parent, isMain) {
      if (specifier === "electron") return { contextBridge: { exposeInMainWorld }, ipcRenderer: { invoke } };
      return originalLoad.call(this, specifier, parent, isMain);
    };
    process.argv = ["electron", "app", ...arguments_];
    delete require.cache[preloadPath];
    try {
      // eslint-disable-next-line import/no-dynamic-require
      require(preloadPath);
    } finally {
      delete require.cache[preloadPath];
      process.argv = originalArguments;
      // eslint-disable-next-line no-underscore-dangle
      nodeModule._load = originalLoad;
    }
    return { api: exposeInMainWorld.mock.calls[0][1], exposeInMainWorld, invoke };
  }

  test("exposes the minimal frozen-channel renderer API", () => {
    const { api, exposeInMainWorld, invoke } = runPreload([ "--advoice-theme=violet" ]);

    expect(exposeInMainWorld).toHaveBeenCalledOnce();
    expect(exposeInMainWorld.mock.calls[0][0]).toBe("electronAPI");
    expect(api.initialTheme).toBe("violet");
    expect(api.isElectron).toBe(true);
    expect(api.getSceneVideoUrl()).toBe("karaoke-media://scene/main");

    expect(api.minimize()).toEqual(["window:minimize"]);
    expect(api.maximize()).toEqual(["window:maximize"]);
    expect(api.close()).toEqual(["window:close"]);
    expect(api.openSongFolder({ id: "42" })).toEqual([ "shell:openSongFolder", { id: "42" } ]);
    expect(api.selectFolder("D:/songs")).toEqual([ "dialog:selectFolder", "D:/songs" ]);
    expect(api.getBackendUrl()).toEqual(["backend:url"]);
    expect(api.copyText("room-code")).toEqual([ "clipboard:writeText", "room-code" ]);
    expect(api.setIconTheme("dark")).toEqual(["window:setIconTheme", "dark"]);
    expect(invoke).toHaveBeenCalledTimes(8);
  });

  test("leaves the initial theme undefined without an installer argument", () => {
    expect(runPreload().api.initialTheme).toBeUndefined();
  });
});
