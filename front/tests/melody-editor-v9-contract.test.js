import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const src = fs.readFileSync(new URL("../src/pages/Library/modals/song-settings/melody-editor.jsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/styles/app.css", import.meta.url), "utf8");

test("transport line uses a monotonic performance clock and GPU transform", () => {
  assert.match(src, /transportClockRef/);
  assert.match(src, /clock\.media \+ \(stamp - clock\.perf\) \/ 1000/);
  assert.match(src, /style\.setProperty\("--editor-playhead-x"/);
  assert.match(css, /translate3d\(var\(--editor-playhead-x/);
  assert.match(css, /will-change:\s*transform/);
});

test("pause does not kill the persistent animation-frame transport loop", () => {
  const pause = src.slice(src.indexOf("const pause = useCallback"), src.indexOf("const play = useCallback"));
  assert.doesNotMatch(pause, /cancelAnimationFrame/);
});

test("editor shortcuts use physical key codes so Ctrl+Z works on non-Latin layouts", () => {
  assert.match(src, /code === "KeyZ"/);
  assert.match(src, /code === "KeyY"/);
  assert.match(src, /code === "KeyA"/);
  assert.doesNotMatch(src, /key === "z"/);
});

test("Ctrl wheel is intercepted at window capture and has one exclusive zoom path", () => {
  assert.match(src, /window\.addEventListener\("wheel", onWheel, \{ passive: false, capture: true \}\)/);
  assert.match(src, /event\.stopImmediatePropagation\?\.\(\)/);
  assert.match(src, /if \(event\.shiftKey\) \{ setHorizontalZoomAnchored\(zoom \+ direction \* 10\); return; \}/);
  assert.match(src, /setVerticalZoomAnchored\(verticalZoom \+ direction\)/);
});

test("piano white keys use contiguous midpoint geometry instead of fixed overlapping heights", () => {
  assert.match(src, /whiteKeyGeometry/);
  assert.match(src, /const top = index === 0 \? 0 : \(previous \+ center\) \/ 2/);
  assert.match(src, /const bottom = index === centers\.length - 1 \? laneHeight : \(center \+ next\) \/ 2/);
  assert.doesNotMatch(src, /rowHeight \* 1\.62/);
});

test("voice follows master transport with drift correction and melody monitor is audible", () => {
  assert.match(src, /Math\.abs\(drift\) > 0\.13/);
  assert.match(src, /playbackRate = clamp\(1 - drift \* 0\.16, 0\.99, 1\.01\)/);
  assert.match(src, /volumes\.melody \* 0\.56/);
});

test("toolbar icons are explicitly centered", () => {
  assert.match(css, /\.melody-editor-tool \{ display:inline-grid !important;place-items:center !important/);
  assert.match(css, /\.melody-editor-tool > svg \{ display:block !important;margin:0 !important/);
});


test("playhead drag previews visually and commits media seek only on release", () => {
  assert.match(src, /const previewPlayhead = useCallback/);
  assert.match(src, /previewPlayhead\(pointerTime\(event\.clientX\)\)/);
  assert.match(src, /seek\(state\.value, !state\.resume\)/);
  assert.match(src, /if \(state\.resume\) await play\(\)/);
});
