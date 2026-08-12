import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/pages/Library/modals/song-settings/melody-editor.jsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/styles/app.css", import.meta.url), "utf8");

test("editor V6 uses a horizontal top deck instead of a left control rail", () => {
  assert.match(source, /melody-editor-topdeck/);
  assert.match(source, /melody-editor-action-groups/);
  assert.doesNotMatch(source, /<aside className="melody-editor-control-rail"/);
});

test("editor V6 auditions notes on click, drag and resize", () => {
  assert.match(source, /auditionNote\(note\.midi_note, 150\)/);
  assert.match(source, /auditionNote\(previewMidi, 95\)/);
  assert.match(source, /lastResizePreview/);
  assert.match(source, /auditionNote\(midi, 220\)/);
});

test("editor V6 has Cubase-like overlay scrollbars with draggable thumbs", () => {
  assert.match(source, /melody-editor-cubase-scrollbar is-horizontal/);
  assert.match(source, /melody-editor-cubase-scrollbar is-vertical/);
  assert.match(source, /startScrollThumbDrag/);
  assert.match(css, /scrollbar-width:\s*none/);
  assert.match(css, /melody-editor-scroll-thumb/);
});

test("editor V6 keeps piano grid compact and integrated zoom strips", () => {
  assert.match(source, /useState\(14\)/);
  assert.match(css, /MIDI EDITOR V6/);
  assert.match(css, /melody-editor-inline-zoom/);
});
