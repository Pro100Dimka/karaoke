import { describe, expect, test } from "vitest";
import {
  normalizeAudioEffects,
  normalizeAudioRuntimeSettings
} from "../src/pages/Karaoke/utils/audio-settings.js";
import {
  findActiveMelodyNote,
  getMelodyGuideState,
  midiToFrequency
} from "../src/pages/Karaoke/utils/melody-guide.js";
import {
  adjacentNoteId,
  canMergeSelectedNotes,
  constrainedMoveDelta,
  deleteNotes,
  marqueeHitIds,
  mergeSelectedNotes,
  resizeBounds
} from "../src/pages/MelodyEditor/model.js";
import {
  flattenLyricsNotes,
  lyricsNoteFillPercent,
  mergeAdjacentLyricsNotes
} from "../src/utils/lyrics-sync.js";

describe("canonical lyricsSync utilities", () => {
  const lyricsSync = {
    bpm: 120,
    key: "Am",
    words: [
      {
        text: "word",
        start: 1,
        end: 3,
        notes: [
          { note: 60, start: 1, end: 2 },
          { note: 62, start: 2, end: 3 }
        ]
      }
    ]
  };

  test("flattens only word-owned notes without changing their values", () => {
    expect(flattenLyricsNotes(lyricsSync)).toEqual([
      expect.objectContaining({
        note: 60,
        start: 1,
        end: 2,
        word_index: 0,
        word_start: 1,
        word_end: 3
      }),
      expect.objectContaining({
        note: 62,
        start: 2,
        end: 3,
        word_index: 0,
        word_start: 1,
        word_end: 3
      })
    ]);
    expect(flattenLyricsNotes(null)).toEqual([]);
    expect(flattenLyricsNotes({ words: [{ notes: "invalid" }] })).toEqual([]);
  });

  test("deduplicates one acoustic note shared by adjacent words", () => {
    const shared = { note: 60, start: 1.2, end: 1.8 };
    const notes = flattenLyricsNotes({
      words: [
        { text: "one", start: 1, end: 1.4, notes: [shared] },
        { text: "two", start: 1.4, end: 2, notes: [shared] }
      ]
    });

    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ ...shared, _id: "note-60:1.2:1.8", word_index: 1 });
  });

  test("assigns a shared note to the word with the largest real overlap", () => {
    const shared = { note: 64, start: 1.1, end: 2.05 };
    const notes = flattenLyricsNotes({
      words: [
        { text: "long", start: 1, end: 2, notes: [shared] },
        { text: "short", start: 2, end: 2.1, notes: [shared] }
      ]
    });

    expect(notes[0]).toMatchObject({ ...shared, word_index: 0, word_text: "long" });
  });

  test("keeps the first word when a shared note overlaps both equally", () => {
    const shared = { note: 65, start: 1.2, end: 1.8 };
    const notes = flattenLyricsNotes({
      words: [
        { text: "first", start: 1, end: 1.5, notes: [shared] },
        { text: "second", start: 1.5, end: 2, notes: [shared] }
      ]
    });

    expect(notes[0].word_text).toBe("first");
  });

  test("uses half-open note boundaries for melody display and sound", () => {
    const notes = flattenLyricsNotes(lyricsSync);
    expect(findActiveMelodyNote(notes, 1.999)).toBe(notes[0]);
    expect(findActiveMelodyNote(notes, 2)).toBe(notes[1]);
    expect(findActiveMelodyNote(notes, 3)).toBeNull();
    expect(midiToFrequency(69)).toBe(440);
    expect(getMelodyGuideState({ notes, position: 2, volume: 1 })).toMatchObject({
      active: true,
      note: notes[1]
    });
  });

  test("fills lyrics evenly across the acoustic note envelope", () => {
    const word = {
      start: 0,
      end: 3,
      notes: [
        { note: 60, start: 0.2, end: 0.3 },
        { note: 60, start: 0.31, end: 1.2 },
        { note: 62, start: 1.5, end: 2.2 }
      ]
    };

    expect(mergeAdjacentLyricsNotes(word)).toEqual([
      { note: 60, start: 0.2, end: 1.2 },
      { note: 62, start: 1.5, end: 2.2 }
    ]);
    expect(lyricsNoteFillPercent(word, 0.2)).toBe(0);
    expect(lyricsNoteFillPercent(word, 1.2)).toBe(50);
    expect(lyricsNoteFillPercent(word, 2.2)).toBe(100);
  });

  test("uses one note's exact start and end and falls back to the word interval", () => {
    const oneNote = {
      start: 1,
      end: 3,
      notes: [{ note: 64, start: 1.5, end: 2.5 }]
    };
    expect(lyricsNoteFillPercent(oneNote, 1.5)).toBe(0);
    expect(lyricsNoteFillPercent(oneNote, 2)).toBe(50);
    expect(lyricsNoteFillPercent(oneNote, 2.5)).toBe(100);
    expect(lyricsNoteFillPercent({ start: 1, end: 3, notes: [] }, 2)).toBe(50);
  });

  test("rejects malformed lyric-note intervals and clips valid notes to their word", () => {
    expect(mergeAdjacentLyricsNotes(null)).toEqual([]);
    expect(mergeAdjacentLyricsNotes({ start: 1, end: 1, notes: [] })).toEqual([]);
    expect(mergeAdjacentLyricsNotes({ start: Number.NaN, end: 2, notes: [] })).toEqual([]);
    expect(
      mergeAdjacentLyricsNotes({
        start: 1,
        end: 3,
        notes: [
          { note: 60.5, start: 1, end: 2 },
          { note: 61, start: Number.NaN, end: 2 },
          { note: 62, start: 1, end: Number.NaN },
          { note: 63, start: 2, end: 2 },
          { note: 64, start: 0, end: 4 }
        ]
      })
    ).toEqual([{ note: 64, start: 1, end: 3 }]);
  });

  test("merges only continuous equal pitches and keeps chronological order", () => {
    const word = {
      start: 0,
      end: 4,
      notes: [
        { note: 64, start: 2, end: 2.4 },
        { note: 60, start: 0.5, end: 1 },
        { note: 60, start: 0.9, end: 1.2 },
        { note: 60, start: 1.41, end: 1.8 },
        { note: 64, start: 2.59, end: 3 }
      ]
    };

    expect(mergeAdjacentLyricsNotes(word)).toEqual([
      { note: 60, start: 0.5, end: 1.2 },
      { note: 60, start: 1.41, end: 1.8 },
      { note: 64, start: 2, end: 3 }
    ]);
  });
});

describe("bounded lyricsSync note editing", () => {
  const notes = [
    { _id: "a", note: 60, start: 1, end: 1.5, word_index: 0, word_start: 1, word_end: 3 },
    { _id: "b", note: 64, start: 1.5, end: 2, word_index: 0, word_start: 1, word_end: 3 },
    { _id: "c", note: 67, start: 3, end: 4, word_index: 1, word_start: 3, word_end: 5 }
  ];

  test("merge, move, resize and delete cannot cross word ownership", () => {
    expect(mergeSelectedNotes(notes, ["a", "b"])).toMatchObject({
      selectedId: "a",
      notes: [expect.objectContaining({ _id: "a", note: 62, start: 1, end: 2 }), notes[2]]
    });
    expect(canMergeSelectedNotes(notes, ["a", "b"])).toBe(true);
    expect(canMergeSelectedNotes(notes, ["b", "c"])).toBe(false);
    expect(mergeSelectedNotes(notes, ["b", "c"]).notes).toBe(notes);
    expect(constrainedMoveDelta(notes, ["a"], -10)).toBe(0);
    expect(constrainedMoveDelta(notes, ["b"], 10)).toBe(1);
    expect(resizeBounds(notes, "b")).toEqual({
      minStart: 1.5,
      maxStart: 1.97,
      minEnd: 1.53,
      maxEnd: 3
    });
    expect(deleteNotes(notes, ["b"])).toEqual([notes[0], notes[2]]);
    expect(adjacentNoteId(notes, ["b"], 1)).toBe("c");
  });

  test("marquee geometry reads the canonical note property", () => {
    expect(
      marqueeHitIds({
        notes,
        x1: 10,
        y1: 0,
        x2: 30,
        y2: 50,
        keyboardWidth: 0,
        zoom: 10,
        rowHeight: 10,
        maxMidi: 64
      })
    ).toEqual(["a", "b"]);
  });
});

test("microphone settings clamp malformed values and preserve noise suppression", () => {
  expect(normalizeAudioEffects({ reverb: 2, echo: -1, delay: 0.5 })).toEqual({
    reverb: 1,
    echo: 0,
    delay: 0.5,
    noise_suppression: 0.35
  });
  expect(
    normalizeAudioRuntimeSettings({ volume: 4, monitoring_enabled: "false", buffer_size: 0 })
  ).toMatchObject({ volume: 2, monitoringEnabled: false, bufferSize: 64 });
});
