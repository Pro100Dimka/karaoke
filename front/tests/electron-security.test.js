import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  getPackagedRendererUrl,
  isAllowedPermissionRequest,
  isAllowedRendererUrl,
  isTrustedIpcEvent
} = require("../electron/security.cjs");

const DEV_ORIGIN = "http://127.0.0.1:5173";
const packagedIndexUrl = getPackagedRendererUrl("C:/app/dist/index.html");

test("development navigation accepts only the exact renderer origin", () => {
  const options = { isDev: true, devOrigin: DEV_ORIGIN, packagedIndexUrl };

  assert.equal(isAllowedRendererUrl(`${DEV_ORIGIN}/`, options), true);
  assert.equal(isAllowedRendererUrl(`${DEV_ORIGIN}/#/karaoke`, options), true);
  assert.equal(
    isAllowedRendererUrl("http://127.0.0.1:5173@evil.example/", options),
    false
  );
  assert.equal(isAllowedRendererUrl("http://localhost:5173/", options), false);
  assert.equal(isAllowedRendererUrl("javascript:alert(1)", options), false);
});

test("packaged navigation accepts only the packaged index file", () => {
  const options = { isDev: false, devOrigin: DEV_ORIGIN, packagedIndexUrl };

  assert.equal(isAllowedRendererUrl(packagedIndexUrl, options), true);
  assert.equal(isAllowedRendererUrl(`${packagedIndexUrl}#/karaoke`, options), true);
  assert.equal(isAllowedRendererUrl("file:///C:/Windows/System32/calc.exe", options), false);
  assert.equal(isAllowedRendererUrl("https://example.com/", options), false);
});

test("IPC requests are accepted only from the active renderer", () => {
  const sender = { isDestroyed: () => false };
  const other = { isDestroyed: () => false };

  assert.equal(isTrustedIpcEvent({ sender }, sender), true);
  assert.equal(isTrustedIpcEvent({ sender: other }, sender), false);
  assert.equal(isTrustedIpcEvent({ sender }, null), false);
  assert.equal(isTrustedIpcEvent({ sender }, { isDestroyed: () => true }), false);
});

test("media permission is limited to audio from the active renderer", () => {
  const webContents = { isDestroyed: () => false };
  const rendererOptions = {
    isDev: true,
    devOrigin: DEV_ORIGIN,
    packagedIndexUrl
  };
  const base = {
    permission: "media",
    requestUrl: `${DEV_ORIGIN}/#/karaoke`,
    mediaTypes: ["audio"],
    webContents,
    expectedWebContents: webContents,
    rendererOptions
  };

  assert.equal(isAllowedPermissionRequest(base), true);
  assert.equal(
    isAllowedPermissionRequest({ ...base, mediaTypes: ["video"] }),
    false
  );
  assert.equal(
    isAllowedPermissionRequest({ ...base, mediaTypes: ["audio", "video"] }),
    false
  );
  assert.equal(
    isAllowedPermissionRequest({ ...base, permission: "notifications" }),
    false
  );
  assert.equal(
    isAllowedPermissionRequest({ ...base, requestUrl: "https://evil.example" }),
    false
  );
  assert.equal(
    isAllowedPermissionRequest({
      ...base,
      webContents: { isDestroyed: () => false }
    }),
    false
  );
});
