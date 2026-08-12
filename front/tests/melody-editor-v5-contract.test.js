import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/pages/Library/modals/song-settings/melody-editor.jsx", import.meta.url), "utf8");

test("editor V5 removes inspector and shortcut help columns", () => {
  assert.equal(source.includes('className="melody-editor-inspector"'), false);
  assert.equal(source.includes('className="melody-editor-shortcuts"'), false);
});

test("editor V5 playhead is draggable and synced from audio", () => {
  assert.equal(source.includes("startPlayheadDrag"), true);
  assert.equal(source.includes("movePlayheadDrag"), true);
  assert.equal(source.includes("onTimeUpdate"), true);
});

test("editor V5 supports wheel zoom shortcuts", () => {
  assert.equal(source.includes("handleRollWheel"), true);
  assert.equal(source.includes("event.ctrlKey"), true);
  assert.equal(source.includes("event.shiftKey"), true);
});
