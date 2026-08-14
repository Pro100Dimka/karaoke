import { beforeEach, expect, test, vi } from "vitest";

let geometry;
let operations;

beforeEach(async () => {
  vi.resetModules();
  [geometry, operations] = await Promise.all([
    import("../src/pages/Library/modals/song-settings/melody-editor-geometry.js"),
    import("../src/pages/Library/modals/song-settings/melody-editor-operations.js")
  ]);
});

test("editor scroll geometry keeps anchors and exact viewport limits", () => {
  expect(geometry.clampEditor(5, 0, 10)).toBe(5);
  expect(geometry.clampEditor(-1, 0, 10)).toBe(0);
  expect(geometry.clampEditor(11, 0, 10)).toBe(10);

  const horizontal = {
    time: 5,
    oldZoom: 10,
    newZoom: 20,
    keyboardWidth: 10,
    scrollLeft: 20,
    clientWidth: 100,
    scrollWidth: 500
  };
  expect(geometry.anchoredHorizontalScroll(horizontal)).toBe(70);
  expect(geometry.anchoredHorizontalScroll({ ...horizontal, time: 100 })).toBe(
    400
  );

  const vertical = {
    scrollTop: 50,
    clientHeight: 100,
    oldRowHeight: 10,
    newRowHeight: 20,
    rowCount: 20
  };
  expect(geometry.anchoredVerticalScroll(vertical)).toBe(150);
  expect(
    geometry.anchoredVerticalScroll({ ...vertical, scrollTop: 1_000 })
  ).toBe(300);

  const follow = {
    scrollLeft: 20,
    clientWidth: 100,
    keyboardWidth: 20,
    scrollWidth: 500
  };
  expect(geometry.autoFollowScrollLeft({ ...follow, playheadX: 70 })).toBe(20);
  expect(geometry.autoFollowScrollLeft({ ...follow, playheadX: 100 })).toBe(40);
  expect(geometry.autoFollowScrollLeft({ ...follow, playheadX: 1_000 })).toBe(
    400
  );

  const noteAnchor = {
    noteMidi: 60,
    maxMidi: 70,
    oldRowHeight: 10,
    newRowHeight: 20,
    scrollTop: 50,
    clientHeight: 100,
    rowCount: 20
  };
  expect(geometry.anchoredVerticalScrollToNote(noteAnchor)).toBe(155);
  expect(
    geometry.anchoredVerticalScrollToNote({ ...noteAnchor, noteMidi: -100 })
  ).toBe(300);
});

test("marquee intersection uses half-closed geometry on every edge", () => {
  const note = { _id: "note", start: 2, end: 4, midi_note: 60 };
  const hit = (bounds, overrides = {}) =>
    geometry.marqueeHitIds({
      notes: [note],
      x1: bounds[0],
      y1: bounds[1],
      x2: bounds[2],
      y2: bounds[3],
      keyboardWidth: 10,
      zoom: 10,
      rowHeight: 10,
      maxMidi: 64,
      ...overrides
    });

  expect(hit([31, 42, 49, 48])).toEqual(["note"]);
  expect(hit([0, 0, 29, 100])).toEqual([]);
  expect(hit([0, 0, 30, 100])).toEqual(["note"]);
  expect(hit([51, 0, 100, 100])).toEqual([]);
  expect(hit([50, 0, 100, 100])).toEqual(["note"]);
  expect(hit([0, 0, 100, 40])).toEqual([]);
  expect(hit([0, 0, 100, 41])).toEqual(["note"]);
  expect(hit([0, 50, 100, 100])).toEqual([]);
  expect(hit([0, 49, 100, 100])).toEqual(["note"]);
  expect(hit([49, 48, 31, 42])).toEqual(["note"]);

  expect(hit([30, 90, 50, 95], { rowHeight: 20 })).toEqual(["note"]);
  expect(
    geometry.marqueeHitIds({
      notes: [{ _id: "zero" }],
      x1: 0,
      y1: 0,
      x2: 8,
      y2: 8,
      keyboardWidth: 0,
      zoom: 10,
      rowHeight: 10,
      maxMidi: 0
    })
  ).toEqual(["zero"]);
  expect(
    geometry.marqueeHitIds({
      notes: null,
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 1,
      keyboardWidth: 0,
      zoom: 1,
      rowHeight: 10,
      maxMidi: 0
    })
  ).toEqual([]);
});

const editorNote = (id, start, end, overrides = {}) => ({
  _id: id,
  start,
  end,
  midi_note: 60,
  syllable_index: Number.NaN,
  ...overrides
});

test("editor note labels use exact ownership and edited-text precedence", () => {
  const syllables = new Map([
    [0, { text: "first", word_index: 3 }],
    [1, { text: "second", word_index: 4 }]
  ]);
  expect(
    operations.displayTextForNote(
      { _id: "a", editor_text: "edited", syllable_index: 0 },
      syllables,
      new Map()
    )
  ).toBe("edited");
  expect(
    operations.displayTextForNote(
      { _id: "a", editor_text: "", syllable_index: 0 },
      syllables,
      new Map([[0, "a"]])
    )
  ).toBe("first");
  expect(
    operations.displayTextForNote(
      { _id: "a", syllable_index: 0 },
      syllables,
      new Map([[0, "other"]])
    )
  ).toBe("");
  expect(
    operations.displayTextForNote(
      { _id: "a", syllable_index: "invalid" },
      syllables,
      new Map()
    )
  ).toBe("");
  expect(
    operations.displayTextForNote(
      { _id: "a", syllable_index: 9 },
      syllables,
      new Map([[9, "a"]])
    )
  ).toBe("");
});

test("merging notes preserves timing, pitch, sources, ordering and text", () => {
  const notes = [
    editorNote("right", 3, 5, {
      midi_note: 63,
      editor_text: "lo",
      word_index: 1,
      syllable_indices: [3, 2]
    }),
    editorNote("keep", 0, 0.5, { midi_note: 40 }),
    editorNote("left", 1, 4, {
      midi_note: 60,
      editor_text: "hello",
      word_index: 1,
      syllable_indices: [2, 1, "bad", 1]
    })
  ];
  const result = operations.mergeSelectedNotes(
    notes,
    ["right", "left"],
    new Map()
  );
  expect(result.selectedId).toBe("left");
  expect(result.notes.map(({ _id }) => _id)).toEqual(["keep", "left"]);
  expect(result.notes[1]).toMatchObject({
    start: 1,
    end: 5,
    midi_note: 62,
    editor_text: "hello",
    syllable_indices: [1, 2, 3]
  });

  const unchanged = operations.mergeSelectedNotes(notes, ["keep"], new Map());
  expect(unchanged).toEqual({ notes, selectedId: "keep" });
  expect(unchanged.notes).toBe(notes);
  expect(operations.mergeSelectedNotes(notes, [], new Map())).toEqual({
    notes,
    selectedId: null
  });
});

test.each([
  ["", "right", 1, 1, "right"],
  ["left", "", 1, 2, "left"],
  ["left", "right", 1, 2, "left right"],
  ["pre", "prefix", 1, 1, "prefix"],
  ["prefix", "fix", 1, 1, "prefix"],
  ["hello", "low", 1, 1, "hellow"],
  ["ab", "cd", 1, 1, "abcd"]
])(
  "note text glue %#: %s + %s",
  (leftText, rightText, leftWord, rightWord, expected) => {
    const notes = [
      editorNote("left", 0, 1, {
        editor_text: leftText,
        word_index: leftWord
      }),
      editorNote("right", 1, 2, {
        editor_text: rightText,
        word_index: rightWord
      })
    ];
    expect(
      operations.mergeSelectedNotes(notes, ["left", "right"], new Map())
        .notes[0].editor_text
    ).toBe(expected);
  }
);

test("word and syllable fallbacks participate in note merging", () => {
  const syllables = new Map([
    [0, { text: "one", word_index: 7 }],
    [1, { text: "net", word_index: 7 }],
    [2, { text: "two", word_index: 8 }]
  ]);
  const notes = [
    editorNote("a", 0, 1, { syllable_index: 0, word_index: "" }),
    editorNote("b", 1, 2, { syllable_index: 1, word_index: null }),
    editorNote("c", 2, 3, { syllable_index: 2, word_index: undefined })
  ];
  expect(
    operations.mergeSelectedNotes(notes, ["a", "b"], syllables).notes[0]
      .editor_text
  ).toBe("onet");
  expect(
    operations.mergeSelectedNotes(notes, ["a", "b"], syllables).notes[0]
      .syllable_indices
  ).toEqual([0, 1]);
  expect(
    operations
      .mergeSelectedNotes(notes, ["b", "c"], syllables)
      .notes.find(({ _id }) => _id === "b").editor_text
  ).toBe("net two");

  const explicitWord = [
    editorNote("fallback", 0, 1, { syllable_index: 0, word_index: "" }),
    editorNote("explicit", 1, 2, {
      editor_text: "net",
      word_index: 7
    })
  ];
  expect(
    operations.mergeSelectedNotes(
      explicitWord,
      ["fallback", "explicit"],
      syllables
    ).notes[0].editor_text
  ).toBe("onet");

  expect(
    operations.mergeSelectedNotes(
      [
        editorNote("missing", 0, 1, { syllable_index: 99 }),
        editorNote("text", 1, 2, { editor_text: "text", word_index: 1 })
      ],
      ["missing", "text"],
      syllables
    ).notes[0].editor_text
  ).toBe("text");
});

test("merging equal-time notes uses end, pitch and source tie breakers", () => {
  const result = operations.mergeSelectedNotes(
    [
      editorNote("long", 1, 3, {
        midi_note: 64,
        editor_text: "b",
        word_index: 2,
        syllable_indices: [4, 2]
      }),
      editorNote("outside-high", 1, 1.5, { midi_note: 70 }),
      editorNote("short", 1, 2, {
        midi_note: 60,
        editor_text: "a",
        word_index: 1,
        syllable_indices: [3, 1]
      }),
      editorNote("outside-low", 1, 1.5, { midi_note: 40 })
    ],
    ["long", "short"],
    new Map()
  );
  expect(result.selectedId).toBe("short");
  expect(result.notes.map(({ _id }) => _id)).toEqual([
    "outside-low",
    "short",
    "outside-high"
  ]);
  expect(result.notes[1]).toMatchObject({
    editor_text: "a b",
    syllable_indices: [1, 2, 3, 4]
  });
});

test("unknown word ownership never glues unrelated note labels", () => {
  const unknown = [
    editorNote("a", 0, 1, { editor_text: "a", word_index: null }),
    editorNote("b", 1, 2, { editor_text: "b", word_index: null })
  ];
  expect(
    operations.mergeSelectedNotes(unknown, ["a", "b"], new Map()).notes[0]
      .editor_text
  ).toBe("a b");

  const interrupted = [
    editorNote("a", 0, 1, { editor_text: "a", word_index: 1 }),
    editorNote("unknown", 1, 2, { editor_text: "?", word_index: null }),
    editorNote("b", 2, 3, { editor_text: "b", word_index: 1 })
  ];
  expect(
    operations.mergeSelectedNotes(interrupted, ["a", "unknown", "b"], new Map())
      .notes[0].editor_text
  ).toBe("a ?b");
});

test("deleting notes transfers text and source ownership to the nearest note", () => {
  const notes = [
    editorNote("right", 3, 4, {
      editor_text: "right",
      word_index: 2,
      syllable_indices: [3]
    }),
    editorNote("gone", 1.5, 2.5, {
      editor_text: "gone",
      word_index: 1,
      syllable_indices: [2, 1]
    }),
    editorNote("left", 0, 1, {
      midi_note: 50,
      editor_text: "left",
      word_index: 3,
      syllable_indices: [0]
    })
  ];
  const result = operations.deleteNotesAndTransferText(
    notes,
    ["gone"],
    new Map()
  );
  expect(result.map(({ _id }) => _id)).toEqual(["left", "right"]);
  expect(result[0]).toMatchObject({
    editor_text: "left gone",
    syllable_indices: [0, 1, 2]
  });
  expect(result[1].editor_text).toBe("right");

  const before = operations.deleteNotesAndTransferText(
    [
      editorNote("gone", 0, 1, {
        editor_text: "pre",
        word_index: 4,
        syllable_indices: [0]
      }),
      editorNote("target", 1, 2, {
        editor_text: "prefix",
        word_index: 4,
        syllable_indices: [1]
      })
    ],
    ["gone"],
    new Map()
  );
  expect(before[0]).toMatchObject({
    editor_text: "prefix",
    syllable_indices: [0, 1]
  });

  const centered = operations.deleteNotesAndTransferText(
    [
      editorNote("target", 0, 4, {
        editor_text: "target",
        word_index: 2
      }),
      editorNote("gone", 1, 3, { editor_text: "gone", word_index: 1 })
    ],
    ["gone"],
    new Map()
  );
  expect(centered[0].editor_text).toBe("gone target");
});

test("deletion chooses the nearest note, breaks ties left and sorts results", () => {
  const result = operations.deleteNotesAndTransferText(
    [
      editorNote("far", 10, 12, { editor_text: "far", midi_note: 60 }),
      editorNote("right", 4, 6, { editor_text: "right", midi_note: 70 }),
      editorNote("gone", 2, 4, { editor_text: "gone", word_index: null }),
      editorNote("left-high", 0, 2, { editor_text: "left", midi_note: 62 }),
      editorNote("left-low", 0, 2, { editor_text: "low", midi_note: 50 })
    ],
    ["gone"],
    new Map()
  );
  expect(result.map(({ _id }) => _id)).toEqual([
    "left-low",
    "left-high",
    "right",
    "far"
  ]);
  expect(result.find(({ _id }) => _id === "left-high").editor_text).toBe(
    "left gone"
  );
  expect(result.find(({ _id }) => _id === "far").editor_text).toBe("far");

  const chronological = operations.deleteNotesAndTransferText(
    [
      editorNote("late", 2, 3, { editor_text: "late", word_index: 2 }),
      editorNote("target", 3, 4, { editor_text: "target", word_index: 3 }),
      editorNote("early", 0, 1, { editor_text: "early", word_index: 1 })
    ],
    ["late", "early"],
    new Map()
  );
  expect(chronological[0].editor_text).toBe("early late target");

  const rightIsNearer = operations.deleteNotesAndTransferText(
    [
      editorNote("left", 0, 0.5, { editor_text: "left" }),
      editorNote("gone", 1, 2, { editor_text: "gone" }),
      editorNote("right", 2, 2.5, { editor_text: "right" })
    ],
    ["gone"],
    new Map()
  );
  expect(rightIsNearer.find(({ _id }) => _id === "right").editor_text).toBe(
    "gone right"
  );
  expect(rightIsNearer.find(({ _id }) => _id === "left").editor_text).toBe(
    "left"
  );

  const firstIsNearer = operations.deleteNotesAndTransferText(
    [
      editorNote("gone", 0, 0.5, { editor_text: "gone" }),
      editorNote("near", 1, 2, { editor_text: "near" }),
      editorNote("far", 2, 2.5, { editor_text: "far" })
    ],
    ["gone"],
    new Map()
  );
  expect(firstIsNearer.find(({ _id }) => _id === "near").editor_text).toBe(
    "gone near"
  );
});

test("deleting empty, absent or all notes has an exact immutable result", () => {
  const a = editorNote("a", 0, 1);
  const b = editorNote("b", 1, 2, { editor_text: "b" });
  const untouched = operations.deleteNotesAndTransferText(
    [a, b],
    [],
    new Map()
  );
  expect(untouched).toEqual([a, b]);
  expect(untouched[0]).not.toBe(a);
  expect(
    operations.deleteNotesAndTransferText([a, b], ["a"], new Map())
  ).toEqual([b]);
  expect(
    operations.deleteNotesAndTransferText([a, b], ["a", "b"], new Map())
  ).toEqual([]);
});

test("adjacent selection follows the canonical note ordering", () => {
  const notes = [
    editorNote("late", 2, 3, { midi_note: 60 }),
    editorNote("long", 0, 2, { midi_note: 60 }),
    editorNote("high", 0, 1, { midi_note: 62 }),
    editorNote("low", 0, 1, { midi_note: 60 })
  ];
  expect(operations.adjacentNoteId([], [], 1)).toBeNull();
  expect(operations.adjacentNoteId(notes, [], 1)).toBe("low");
  expect(operations.adjacentNoteId(notes, [], -1)).toBe("late");
  expect(operations.adjacentNoteId(notes, ["low"], 1)).toBe("high");
  expect(operations.adjacentNoteId(notes, ["late"], 1)).toBe("late");
  expect(operations.adjacentNoteId(notes, ["late"], -1)).toBe("long");
  expect(operations.adjacentNoteId(notes, ["low"], -1)).toBe("low");
  expect(operations.adjacentNoteId(notes, ["high", "long"], -1)).toBe("high");
  expect(operations.adjacentNoteId(notes, ["high", "long"], 1)).toBe("long");
  expect(operations.adjacentNoteId(notes, [], 0)).toBe("late");
  expect(operations.adjacentNoteId(notes, ["high"], 0)).toBe("low");
  expect(operations.adjacentNoteId(notes, ["high", "long"], 0)).toBe("high");
});

test("moving notes is clamped by duration and neighboring notes", () => {
  const notes = [
    editorNote("before", 0, 1),
    editorNote("moving-a", 1, 2),
    editorNote("moving-b", 2, 4),
    editorNote("after", 4, 5)
  ];
  expect(operations.constrainedMoveDelta(notes, [], 1, 10)).toBe(0);
  expect(
    operations.constrainedMoveDelta(notes, ["moving-a", "moving-b"], -5, 10)
  ).toBe(0);
  expect(
    operations.constrainedMoveDelta(notes, ["moving-a", "moving-b"], 5, 10)
  ).toBe(0);
  expect(
    operations.constrainedMoveDelta(
      notes.filter(({ _id }) => _id !== "after"),
      ["moving-a", "moving-b"],
      20,
      6
    )
  ).toBe(2);
  expect(
    operations.constrainedMoveDelta(
      notes.filter(({ _id }) => _id !== "before"),
      ["moving-a", "moving-b"],
      -20,
      10
    )
  ).toBe(-1);

  const epsilon = 1e-9;
  expect(
    operations.constrainedMoveDelta(
      [editorNote("before", 0, 1 + epsilon), editorNote("moving", 1, 2)],
      ["moving"],
      -1,
      10
    )
  ).toBeCloseTo(epsilon, 15);
  expect(
    operations.constrainedMoveDelta(
      [editorNote("moving", 1, 2), editorNote("after", 2 - epsilon, 3)],
      ["moving"],
      1,
      10
    )
  ).toBeCloseTo(-epsilon, 15);
});

test("resize bounds stop exactly at neighboring notes", () => {
  const notes = [
    editorNote("before", 0, 1),
    editorNote("current", 1, 3),
    editorNote("after", 3, 4)
  ];
  expect(operations.resizeBounds(notes, "missing", 10)).toBeNull();
  expect(operations.resizeBounds(notes, "current", 10)).toEqual({
    minStart: 1,
    maxStart: 2.97,
    minEnd: 1.03,
    maxEnd: 3
  });
  expect(operations.resizeBounds([notes[1]], "current", 8, 0.5)).toEqual({
    minStart: 0,
    maxStart: 2.5,
    minEnd: 1.5,
    maxEnd: 8
  });

  const epsilon = 1e-9;
  const nearBounds = operations.resizeBounds(
    [
      editorNote("before", 0, 1 + epsilon),
      editorNote("current", 1, 3),
      editorNote("after", 3 - epsilon, 4)
    ],
    "current",
    10
  );
  expect(nearBounds.minStart).toBeCloseTo(1 + epsilon, 15);
  expect(nearBounds.maxEnd).toBeCloseTo(3 - epsilon, 15);
});
