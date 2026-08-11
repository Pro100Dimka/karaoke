import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLyrics } from '../src/pages/Karaoke/utils/data.js';
import { buildLyricWordTimings, getLyricDisplayState, getLyricFill } from '../src/pages/Karaoke/utils/lyrics.js';

test('missing line timestamp never becomes zero-time lyric', () => {
  const lines = normalizeLyrics([{ text: 'bad' }, { text: 'good', start: 3, end: 5 }]);
  assert.deepEqual(lines.map(({text,start,end}) => ({text,start,end})), [{ text:'good', start:3, end:5 }]);
});

test('partially timed words preserve textual source order', () => {
  const [line] = normalizeLyrics([{ words: [
    { word:'one', start:1, end:1.2 },
    { word:'two' },
    { word:'three', start:1.6, end:2 }
  ]}]);
  assert.equal(line.text, 'one two three');
  assert.deepEqual(line.words.map(w => w.text), ['one','two','three']);
});

test('overlapping lines select the most recently started active line', () => {
  const state = getLyricDisplayState([
    { text:'old', start:1, end:5 },
    { text:'new', start:3, end:4 }
  ], 3.5);
  assert.equal(state.currentLine.text, 'new');
});

test('word timing repair is monotonic and stays inside line', () => {
  const words = buildLyricWordTimings({ start:10, end:12, words:[
    {text:'a', start:9, end:10.5},
    {text:'b', start:10.2, end:99},
    {text:'c'}
  ]});
  for (let i=0;i<words.length;i++) {
    assert.ok(words[i].start >= 10 && words[i].end <= 12);
    assert.ok(words[i].end >= words[i].start);
    if (i) assert.ok(words[i].start >= words[i-1].end);
  }
});

test('lyric fill clamps invalid/outside progress', () => {
  assert.equal(getLyricFill(0,1,2), 0);
  assert.equal(getLyricFill(3,1,2), 1);
  assert.equal(getLyricFill(1.5,1,2), .5);
  assert.equal(getLyricFill(NaN,1,2), 0);
});
