
import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const src = fs.readFileSync(new URL("../src/pages/Library/modals/song-settings/melody-editor.jsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/styles/app.css", import.meta.url), "utf8");

test("playhead is moved directly every animation frame", () => {
  assert.match(src, /requestAnimationFrame\(sync\)/);
  assert.match(src, /--editor-playhead-x/);
  assert.match(src, /style\.setProperty\("--editor-playhead-x"/);
  assert.match(css, /\.melody-editor-playhead[\s\S]*will-change:\s*transform/);
  assert.match(css, /\.melody-editor-playhead[\s\S]*transition:\s*none/);
});

test("toolbar uses round karaoke-console color tones", () => {
  assert.match(src, /"green"/);
  assert.match(src, /"blue"/);
  assert.match(src, /"amber"/);
  assert.match(src, /"cyan"/);
  assert.match(src, /"pink"/);
  assert.match(css, /border-radius:\s*50%/);
});
