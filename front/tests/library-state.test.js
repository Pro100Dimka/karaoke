import assert from "node:assert/strict";
import test from "node:test";
import {
  countReadySongs,
  filterSongs,
  getLocalVisibleSongs,
  getSongCardState,
  resolveVisibleSongs
} from "../src/pages/Library/utils.js";

const songs = [
  { id: "1", title: "Alpha", artist: "Singer", genre: "Rock", status: "done" },
  {
    id: "2",
    title: "Beta",
    artist: "Other",
    genre: "Pop",
    status: "processing"
  },
  { id: "3", title: "Gamma", artist: "Singer", genre: "Jazz", status: "error" }
];

for (const value of [null, undefined, 0, false, {}, "songs"]) {
  test(`library helpers tolerate non-array source ${String(value)}`, () => {
    assert.deepEqual(getLocalVisibleSongs(value, new Set()), []);
    assert.deepEqual(filterSongs(value, "a"), []);
    assert.equal(countReadySongs(value), 0);
  });
}

test("getLocalVisibleSongs removes hidden and malformed songs", () => {
  const result = getLocalVisibleSongs([...songs, null, 5], new Set(["2"]));
  assert.deepEqual(
    result.map((song) => song.id),
    ["1", "3"]
  );
});

test("getLocalVisibleSongs accepts invalid hidden set", () => {
  assert.equal(getLocalVisibleSongs(songs, null).length, 3);
});

for (const [query, expected] of [
  ["", ["1", "2", "3"]],
  ["   ", ["1", "2", "3"]],
  ["alpha", ["1"]],
  ["SINGER", ["1", "3"]],
  ["pop", ["2"]],
  ["missing", []],
  [null, ["1", "2", "3"]],
  [42, ["1", "2", "3"]]
]) {
  test(`filterSongs query ${String(query)}`, () => {
    assert.deepEqual(
      filterSongs(songs, query).map((song) => song.id),
      expected
    );
  });
}

test("filterSongs tolerates malformed song fields", () => {
  const result = filterSongs(
    [
      { id: "1", title: null, artist: 5, genre: "Rock" },
      null,
      { id: "2", title: "Valid" }
    ],
    "rock"
  );
  assert.deepEqual(
    result.map((song) => song.id),
    ["1"]
  );
});

test("resolveVisibleSongs uses host local library", () => {
  assert.equal(
    resolveVisibleSongs({
      localSongs: songs,
      room: { host: true },
      roomSongs: [{ id: "remote" }]
    }),
    songs
  );
});

test("resolveVisibleSongs uses remote library for guest", () => {
  const remote = [{ id: "remote" }, null, 5];
  assert.deepEqual(
    resolveVisibleSongs({
      localSongs: songs,
      room: { host: false },
      roomSongs: remote
    }),
    [{ id: "remote" }]
  );
});

test("resolveVisibleSongs falls back when remote songs are invalid", () => {
  assert.equal(
    resolveVisibleSongs({
      localSongs: songs,
      room: { host: false },
      roomSongs: null
    }),
    songs
  );
});

for (const [status, expected] of [
  ["done", { status: "done", isWorking: false, isReady: true }],
  ["processing", { status: "processing", isWorking: true, isReady: false }],
  ["cancelling", { status: "cancelling", isWorking: true, isReady: false }],
  ["error", { status: "error", isWorking: false, isReady: false }],
  [null, { status: "pending", isWorking: false, isReady: false }]
]) {
  test(`getSongCardState ${String(status)}`, () => {
    assert.deepEqual(getSongCardState({ status }), expected);
  });
}

test("countReadySongs counts only exact done status", () => {
  assert.equal(countReadySongs([...songs, { status: "DONE" }, null]), 1);
});
