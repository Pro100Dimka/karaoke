import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  installBackendFileAuthentication,
  shouldAuthenticateBackendFileRequest
} = require("../electron/backend-media-auth.cjs");

const backend = "http://127.0.0.1:19823";
for (const pathname of [
  "/songs/song-1/audio/instrumental",
  "/songs/song-1/audio/vocals",
  "/songs/song-1/cover",
  "/songs/song-1/video",
  "/recording/take-1/file",
  "/recording/take-1/performance"
]) {
  assert.equal(
    shouldAuthenticateBackendFileRequest({ method: "GET", url: `${backend}${pathname}` }, backend),
    true,
    pathname
  );
}
for (const [method, pathname] of [
  ["POST", "/songs/song-1/audio/instrumental"],
  ["GET", "/songs/song-1"],
  ["POST", "/songs/song-1/process"],
  ["POST", "/cache/clear"],
  ["GET", "/songs/song-1/audio/not-a-track"]
]) {
  assert.equal(
    shouldAuthenticateBackendFileRequest({ method, url: `${backend}${pathname}` }, backend),
    false,
    `${method} ${pathname}`
  );
}
assert.equal(
  shouldAuthenticateBackendFileRequest(
    { method: "GET", url: "https://evil.example/songs/song-1/audio/instrumental" },
    backend
  ),
  false
);

let listener;
installBackendFileAuthentication(
  {
    onBeforeSendHeaders(_filter, callback) {
      listener = callback;
    }
  },
  backend,
  "launch-secret"
);
assert.equal(typeof listener, "function");
listener(
  {
    method: "GET",
    url: `${backend}/songs/song-1/audio/instrumental`,
    requestHeaders: { Range: "bytes=0-" }
  },
  ({ requestHeaders }) => {
    assert.equal(requestHeaders["X-ADVoice-Token"], "launch-secret");
    assert.equal(requestHeaders.Range, "bytes=0-");
  }
);
listener(
  { method: "POST", url: `${backend}/songs/song-1/process`, requestHeaders: {} },
  ({ requestHeaders }) => assert.equal(requestHeaders["X-ADVoice-Token"], undefined)
);

console.log("Electron backend media authentication audit passed.");
