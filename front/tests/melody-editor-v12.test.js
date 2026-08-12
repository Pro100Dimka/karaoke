
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { marqueeHitIds, anchoredHorizontalScroll, anchoredVerticalScrollToNote } from "../src/pages/Library/modals/song-settings/melody-editor-geometry.js";

const src=fs.readFileSync(new URL("../src/pages/Library/modals/song-settings/melody-editor.jsx",import.meta.url),"utf8");
const css=fs.readFileSync(new URL("../src/styles/app.css",import.meta.url),"utf8");

test("marquee selects and can highlight multiple notes while dragging",()=>{
  const notes=[
    {_id:"a",start:1,end:2,midi_note:60},
    {_id:"b",start:2.2,end:3,midi_note:61},
    {_id:"c",start:8,end:9,midi_note:70},
  ];
  const ids=marqueeHitIds({notes,x1:80,y1:90,x2:300,y2:130,keyboardWidth:82,zoom:60,rowHeight:14,maxMidi:68});
  assert.deepEqual(ids.sort(),["a","b"]);
  assert.match(src,/setSelected\(marqueeSelection\(state\)\)/);
  assert.match(css,/\.melody-editor-note\.is-selected[\s\S]*outline:\s*2px/);
});

test("horizontal anchor preserves playhead exact screen x",()=>{
  const args={time:30,oldZoom:60,newZoom:100,keyboardWidth:82,scrollLeft:1500,clientWidth:900,scrollWidth:6000};
  const before=args.keyboardWidth+args.time*args.oldZoom-args.scrollLeft;
  const next=anchoredHorizontalScroll(args);
  const after=args.keyboardWidth+args.time*args.newZoom-next;
  assert.equal(after,before);
});

test("vertical note anchor preserves exact screen y",()=>{
  const args={noteMidi:64,maxMidi:84,oldRowHeight:14,newRowHeight:28,scrollTop:200,clientHeight:600,rowCount:70};
  const before=(args.maxMidi-args.noteMidi+.5)*args.oldRowHeight-args.scrollTop;
  const next=anchoredVerticalScrollToNote(args);
  const after=(args.maxMidi-args.noteMidi+.5)*args.newRowHeight-next;
  assert.equal(after,before);
});

test("zoom commits synchronously before scroll compensation",()=>{
  assert.match(src,/flushSync\(\(\) => setZoom\(next\)\)/);
  assert.match(src,/flushSync\(\(\) => setVerticalZoom\(next\)\)/);
  assert.doesNotMatch(src,/setZoom\(next\);\s*requestAnimationFrame/);
  assert.doesNotMatch(src,/setVerticalZoom\(next\);\s*requestAnimationFrame/);
});

test("editor SongStrip hides duplicate cover and song metadata",()=>{
  assert.match(src,/melody-editor-waveform-only/);
  assert.match(css,/\.melody-editor-waveform-only \.karaoke-song-cover,[\s\S]*\.karaoke-player-meta[\s\S]*display:\s*none/);
});
