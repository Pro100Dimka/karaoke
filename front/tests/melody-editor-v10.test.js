
import test from "node:test";
import assert from "node:assert/strict";
import {
  anchoredHorizontalScroll,
  anchoredVerticalScroll,
  autoFollowScrollLeft
} from "../src/pages/Library/modals/song-settings/melody-editor-geometry.js";
import {
  adjacentNoteId,
  constrainedMoveDelta,
  deleteNotesAndTransferText,
  mergeSelectedNotes,
  resizeBounds
} from "../src/pages/Library/modals/song-settings/melody-editor-operations.js";

const syllables = new Map([
  [0, { index:0, word_index:0, text:"бол" }],
  [1, { index:1, word_index:0, text:"ьшой" }],
  [2, { index:2, word_index:1, text:"дом" }]
]);

test("horizontal zoom preserves playhead screen position", () => {
  const old = {time:30, oldZoom:60, newZoom:120, keyboardWidth:82, scrollLeft:1200, clientWidth:1000, scrollWidth:5000};
  const before=old.keyboardWidth+old.time*old.oldZoom-old.scrollLeft;
  const left=anchoredHorizontalScroll(old);
  const after=old.keyboardWidth+old.time*old.newZoom-left;
  assert.equal(after,before);
});

test("vertical zoom preserves viewport center pitch row", () => {
  const top=anchoredVerticalScroll({scrollTop:400,clientHeight:600,oldRowHeight:14,newRowHeight:28,rowCount:80});
  const oldCenter=(400+300)/14;
  const newCenter=(top+300)/28;
  assert.equal(newCenter,oldCenter);
});

test("auto follow starts only after playhead crosses middle of editable viewport", () => {
  const same=autoFollowScrollLeft({playheadX:400,scrollLeft:0,clientWidth:1000,keyboardWidth:82,scrollWidth:5000});
  assert.equal(same,0);
  const moved=autoFollowScrollLeft({playheadX:800,scrollLeft:0,clientWidth:1000,keyboardWidth:82,scrollWidth:5000});
  assert.ok(moved>0);
  const screen=800-moved;
  assert.equal(screen,82+(1000-82)*.5);
});

test("merge combines syllable fragments without changing unrelated notes", () => {
  const notes=[
    {_id:"a",start:1,end:1.3,midi_note:60,word_index:0,syllable_index:0},
    {_id:"b",start:1.3,end:1.7,midi_note:62,word_index:0,syllable_index:1},
    {_id:"c",start:3,end:3.4,midi_note:64,word_index:1,syllable_index:2}
  ];
  const r=mergeSelectedNotes(notes,["a","b"],syllables);
  assert.equal(r.notes.length,2);
  const merged=r.notes.find(n=>n._id==="a");
  assert.equal(merged.editor_text,"большой");
  assert.equal(merged.start,1);
  assert.equal(merged.end,1.7);
  assert.deepEqual(merged.syllable_indices,[0,1]);
  assert.deepEqual(r.notes.find(n=>n._id==="c"),notes[2]);
});

test("delete transfers deleted text to nearest note in chronological order", () => {
  const notes=[
    {_id:"a",start:1,end:1.3,midi_note:60,word_index:0,syllable_index:0},
    {_id:"b",start:1.31,end:1.7,midi_note:62,word_index:0,syllable_index:1}
  ];
  const r=deleteNotesAndTransferText(notes,["a"],syllables);
  assert.equal(r.length,1);
  assert.equal(r[0]._id,"b");
  assert.equal(r[0].editor_text,"большой");
  assert.deepEqual(r[0].syllable_indices,[0,1]);
  assert.equal(r[0].start,1.31);
  assert.equal(r[0].end,1.7);
  assert.equal(r[0].midi_note,62);
});

test("plain arrows navigate while Ctrl+arrows can remain movement commands", () => {
  const notes=[{_id:"a",start:1,end:2},{_id:"b",start:3,end:4},{_id:"c",start:5,end:6}];
  assert.equal(adjacentNoteId(notes,["b"],1),"c");
  assert.equal(adjacentNoteId(notes,["b"],-1),"a");
});


test("moving notes stops at the nearest unselected note and never overlaps it", () => {
  const notes=[
    {_id:"a",start:1,end:2,midi_note:60},
    {_id:"b",start:3,end:4,midi_note:62},
    {_id:"c",start:5,end:6,midi_note:64}
  ];
  assert.equal(constrainedMoveDelta(notes,["b"],5,10),1);
  assert.equal(constrainedMoveDelta(notes,["b"],-5,10),-1);
});

test("left resize can extend left but stops exactly at previous note", () => {
  const notes=[
    {_id:"a",start:1,end:2,midi_note:60},
    {_id:"b",start:3,end:4,midi_note:62},
    {_id:"c",start:5,end:6,midi_note:64}
  ];
  const bounds=resizeBounds(notes,"b",10);
  assert.equal(bounds.minStart,2);
  assert.equal(bounds.maxStart,3.97);
  assert.equal(bounds.maxEnd,5);
});
