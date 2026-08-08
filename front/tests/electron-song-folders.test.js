import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  findMatchingSongFolder,
  normalizeFolderName
} = require("../electron/song-folders.cjs");

const directory = (name) => ({ name, isDirectory: () => true });
const file = (name) => ({ name, isDirectory: () => false });

test("song folder names are normalized consistently", () => {
  assert.equal(normalizeFolderName("  Ёлка — Прованс! "), "ёлкапрованс");
});

test("exact song folder matches win over partial matches", () => {
  const exact = directory("Song");
  assert.equal(
    findMatchingSongFolder([directory("Song Extended"), exact], ["Song"]),
    exact
  );
});

test("a unique partial song folder can be resolved", () => {
  const match = directory("Artist - Long Song Title");
  assert.equal(
    findMatchingSongFolder([file("Artist"), match], ["Long Song"]),
    match
  );
});

test("ambiguous partial matches do not open an arbitrary folder", () => {
  assert.equal(
    findMatchingSongFolder(
      [directory("Song Live"), directory("Song Studio")],
      ["Song"]
    ),
    null
  );
});
