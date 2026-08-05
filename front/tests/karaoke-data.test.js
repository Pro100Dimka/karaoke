import assert from "node:assert/strict";
import test from "node:test";

import {
  createPanoramaPath,
  getYouTubeVideoId,
  normalizeLyrics,
  normalizeNotes,
  noteNameToMidi,
  playbackGain,
  transposeKey,
  youTubeEmbedUrl
} from "../src/pages/Karaoke/utils/data.js";

test("noteNameToMidi supports sharps, flats and invalid values", () => {
  assert.equal(noteNameToMidi("C4"), 60);
  assert.equal(noteNameToMidi("A4"), 69);
  assert.equal(noteNameToMidi("Db4"), 61);
  assert.equal(noteNameToMidi("c#4"), 61);
  assert.equal(noteNameToMidi("invalid"), null);
  assert.equal(noteNameToMidi(null), null);
});

test("normalizeLyrics accepts pipeline aliases and word timings", () => {
  const result = normalizeLyrics({
    segments: [
      {
        begin: "1",
        end: "5",
        line: "Привет мир",
        words: [
          { word: "Привет", start: "1.2", end: "2.1" },
          { text: "мир", start: "2.2", end: "3.4" }
        ]
      }
    ]
  });

  assert.deepEqual(result, [
    {
      start: 1.2,
      end: 3.4,
      text: "Привет мир",
      words: [
        { text: "Привет", start: 1.2, end: 2.1 },
        { text: "мир", start: 2.2, end: 3.4 }
      ]
    }
  ]);
});

test("normalizeLyrics drops empty lines and malformed word marks", () => {
  assert.deepEqual(
    normalizeLyrics([
      { start: 0, end: 2, text: "" },
      {
        start: 1,
        end: 3,
        text: "Строка",
        words: [{ text: "bad", start: 2, end: 1 }]
      }
    ]),
    [{ start: 1, end: 3, text: "Строка", words: [] }]
  );
});

test("normalizeNotes accepts midi, pitch and note names", () => {
  assert.deepEqual(
    normalizeNotes([
      { start: "0", end: "1", midi: 60 },
      { start: 1, end: 2, pitch: "61" },
      { start: 2, end: 3, note: "D4" },
      { start: 4, end: 3, midi: 70 },
      { start: "bad", end: 5, midi: 70 }
    ]),
    [
      { start: 0, end: 1, midi: 60 },
      { start: 1, end: 2, midi: 61 },
      { start: 2, end: 3, midi: 62 }
    ]
  );
});

test("transposeKey preserves suffix and wraps octaves", () => {
  assert.equal(transposeKey("C minor", 2), "D minor");
  assert.equal(transposeKey("Bb major", 2), "C major");
  assert.equal(transposeKey("B", 1), "C");
  assert.equal(transposeKey("Am", -3), "F#m");
  assert.equal(transposeKey(null, 1), "Тональность не определена");
});

test("playbackGain clamps and applies perceptual square curve", () => {
  assert.equal(playbackGain(-1), 0);
  assert.equal(playbackGain(0.5), 0.25);
  assert.equal(playbackGain(2), 1);
  assert.equal(playbackGain("bad"), 0);
});

test("YouTube helpers accept supported URL forms only", () => {
  const id = "dQw4w9WgXcQ";
  assert.equal(getYouTubeVideoId(`https://youtu.be/${id}`), id);
  assert.equal(getYouTubeVideoId(`https://www.youtube.com/watch?v=${id}`), id);
  assert.equal(getYouTubeVideoId(`https://youtube.com/shorts/${id}`), id);
  assert.equal(getYouTubeVideoId("https://example.com/video"), null);
  assert.equal(getYouTubeVideoId("not a url"), null);
  assert.match(youTubeEmbedUrl(id), new RegExp(`/embed/${id}\\?`));
});

test("createPanoramaPath can be generated deterministically in tests", () => {
  const values = [0, 0.25, 0.5, 0.75, 1];
  let index = 0;
  const path = createPanoramaPath(() => values[index++]);

  assert.deepEqual(path, {
    xPhaseA: 0,
    xPhaseB: Math.PI / 2,
    xPhaseC: Math.PI,
    yPhaseA: (Math.PI * 3) / 2,
    yPhaseB: Math.PI * 2
  });
});
