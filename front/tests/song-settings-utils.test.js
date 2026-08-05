import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLyricsData,
  createSongPayload,
  getSelectedSong,
  lyricsToText,
  normalizeText,
  parseLyricsText
} from "../src/pages/Library/song-settings/utils.js";

test("normalizeText trims values and preserves empty fallback semantics", () => {
  assert.equal(normalizeText("  Song  "), "Song");
  assert.equal(normalizeText("   "), null);
  assert.equal(normalizeText(null), null);
});

test("lyrics conversion is stable", () => {
  assert.deepEqual(parseLyricsText(" first \n\n second "), ["first", "second"]);
  assert.equal(
    lyricsToText([{ text: "first" }, {}, { text: "third" }]),
    "first\n\nthird"
  );
});

test("buildLyricsData preserves timing data and replaces text by index", () => {
  const lines = [
    { start: 1, text: "old" },
    { start: 2, text: "keep" }
  ];
  assert.deepEqual(buildLyricsData(lines, ["new"]), [
    { start: 1, text: "new" },
    { start: 2, text: "keep" }
  ]);
});

test("getSelectedSong selects requested or first song", () => {
  const songs = [{ id: "a" }, { id: "b" }];
  assert.equal(getSelectedSong(songs, "b"), songs[1]);
  assert.equal(getSelectedSong(songs), songs[0]);
  assert.equal(getSelectedSong([], "missing"), undefined);
});

test("createSongPayload normalizes text fields and booleans", () => {
  const payload = createSongPayload(
    {
      title: "  ",
      artist: " Artist ",
      genre: null,
      key_override: " C ",
      tempo_override: 120,
      note_range_min: 40,
      note_range_max: 70,
      difficulty_override: " easy ",
      video_url: " url ",
      show_lyrics: 1,
      show_notes: 0
    },
    { title: "Existing" }
  );
  assert.deepEqual(payload, {
    title: "Existing",
    artist: "Artist",
    genre: null,
    key_override: "C",
    tempo_override: 120,
    note_range_min: 40,
    note_range_max: 70,
    difficulty_override: "easy",
    video_url: "url",
    show_lyrics: true,
    show_notes: false
  });
});
