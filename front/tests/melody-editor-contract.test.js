import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const editor = fs.readFileSync(path.join(root, "src/pages/Library/modals/song-settings/melody-editor.jsx"), "utf8");
const library = fs.readFileSync(path.join(root, "src/pages/Library/index.jsx"), "utf8");

test("melody editor keeps the canonical editing controls", () => {
  for (const token of ["saveSongEditor", "resetSongEditor", "syllable_index", "Соединить", "Удалить", "Вокал", "Мелодия", "Минус"]) {
    assert.equal(editor.includes(token), true, token);
  }
});

test("processing modal preserves terminal status before polling is released", () => {
  assert.match(library, /setProcessingSong\(\(current\)/);
  assert.match(library, /status:\s*processingStatus\.status/);
  assert.match(library, /Promise\.resolve\(refreshSongs\(\)\)/);
});

test("melody editor exposes Cubase-style multi-selection hotkeys", () => {
  for (const token of [
    'code === "KeyA"',
    'event.key === "Delete"',
    'event.key === "ArrowLeft"',
    'event.key === "ArrowRight"',
    'event.key === "ArrowUp"',
    'event.key === "ArrowDown"',
    'event.shiftKey ? 12 : 1',
    'selectAdjacentNote(direction)',
    'nudgeSelected(direction * (event.shiftKey ? 0.25 : 0.05)',
    'code === "KeyZ" && event.shiftKey',
    'code === "KeyD"',
    'code === "KeyC"',
    'code === "KeyV"',
    'event.code === "Space"'
  ]) assert.equal(editor.includes(token), true, token);
});

test("melody editor supports marquee and group dragging", () => {
  for (const token of [
    "melody-editor-selection-box",
    "startMarquee",
    "updateMarquee",
    "endMarquee",
    "movingSelection",
    "state.originals",
    "event.shiftKey ? 0 : rawDy"
  ]) assert.equal(editor.includes(token), true, token);
});
