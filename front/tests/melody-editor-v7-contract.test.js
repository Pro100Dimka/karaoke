import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync("src/pages/Library/modals/song-settings/melody-editor.jsx", "utf8");
const css = fs.readFileSync("src/styles/app.css", "utf8");

test("editor V7 consumes modifier shortcuts exactly once", () => {
  assert.match(source, /addEventListener\("wheel", onWheel, \{ passive: false, capture: true \}\)/);
  assert.match(source, /stopImmediatePropagation\?\.\(\)/);
  assert.match(source, /addEventListener\("keydown", onKeyDown, true\)/);
  assert.doesNotMatch(source, /className="melody-editor-roll-shell" onWheel=/);
});

test("editor V7 fixes undo redo and live playhead polling", () => {
  assert.match(source, /mod && code === "KeyZ" && event\.shiftKey/);
  assert.match(source, /mod && code === "KeyZ"/);
  assert.match(source, /requestAnimationFrame\(sync\)/);
  assert.match(source, /!master\.paused && !master\.ended/);
});

test("editor V7 has compact piano rows and musical audition", () => {
  assert.match(source, /useState\(14\)/);
  assert.match(source, /min="10" max="36"/);
  assert.match(source, /createBiquadFilter/);
  assert.match(source, /\["triangle", frequency \* 2, 0\.16\]/);
  assert.match(css, /MIDI EDITOR V7/);
});

test("editor V11 keeps ordered horizontal controls and titled editor header", () => {
  assert.match(source, /VOCAL MELODY EDITOR/);
  const tools = source.indexOf('className="melody-editor-action-groups"');
  const transport = source.indexOf('className="melody-editor-transport melody-editor-waveform-only"');
  assert.ok(tools >= 0 && tools < transport);
  assert.match(css, /\.melody-editor-tool-group/);
  assert.match(css, /\.melody-editor-topdeck-v11/);
});
