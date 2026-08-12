
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const src=fs.readFileSync(new URL("../src/pages/Library/modals/song-settings/melody-editor.jsx",import.meta.url),"utf8");

test("V10 transport and shortcuts are wired",()=>{
  assert.match(src,/Crosshair/);
  assert.match(src,/autoScroll/);
  assert.match(src,/playbackOriginRef/);
  assert.match(src,/autoFollowScrollLeft/);
  assert.match(src,/mod\) \{ nudgeSelected\(direction \* \(event\.shiftKey \? 0\.25 : 0\.05\)/);
  assert.match(src,/selectAdjacentNote\(direction\)/);
  assert.doesNotMatch(src,/style=\{\{ "--editor-playhead-x"/);
});

test("V10 text operations are wired",()=>{
  assert.match(src,/deleteNotesAndTransferText/);
  assert.match(src,/mergeSelectedNotes/);
  assert.match(src,/editor_text/);
  assert.match(src,/displayTextForNote/);
});
