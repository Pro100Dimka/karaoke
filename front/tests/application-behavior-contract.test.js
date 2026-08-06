import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const library = read("src/pages/Library/index.jsx");
const dialog = read("src/contexts/AppDialog.jsx");
const modal = read("src/components/modal/index.jsx");
const audioPlayer = read("src/components/AudioPlayer.jsx");
const theme = read("src/utils/theme.js");
const routes = read("src/components/routes.jsx");

const libraryContracts = [
  "<LibraryBackdrop />",
  "<LibraryHero songCount={visibleSongs.length} readyCount={readyCount} />",
  "<LibrarySongCard",
  "getLocalVisibleSongs(songs, hiddenSongIds)",
  "resolveVisibleSongs({",
  "filterSongs(visibleSongs, query)",
  "countReadySongs(visibleSongs)",
  "getErrorMessage(err)"
];
for (const contract of libraryContracts) {
  test(`Library keeps refactored contract: ${contract}`, () => {
    assert.equal(library.includes(contract), true);
  });
}

test("Library no longer contains dead information panel state", () => {
  assert.equal(library.includes("infoSong"), false);
  assert.equal(library.includes("SongInfo"), false);
});

test("Library does not read unknown thrown values through err.message", () => {
  assert.equal(library.includes("err.message"), false);
});

test("AppDialog backdrop is not a fake keyboard button", () => {
  assert.equal(dialog.includes('role="button"'), false);
  assert.equal(modal.includes('role="presentation"'), true);
});

test("AppDialog has one backdrop activation path", () => {
  assert.equal(modal.includes("onMouseDown={(event)"), true);
  assert.equal(modal.includes("onTouchStart="), false);
  assert.equal(modal.includes("onKeyDown="), false);
});

test("AppDialog locks and restores document scrolling", () => {
  assert.equal(
    modal.includes('document.body.style.overflow = "hidden"'),
    true
  );
  assert.equal(
    modal.includes("document.body.style.overflow = previousOverflow"),
    true
  );
});

for (const helper of [
  "normalizeAudioDuration",
  "normalizeAudioPosition",
  "normalizeAudioVolume",
  "toggleAudioPlayback",
  "formatAudioTime"
]) {
  test(`AudioPlayer delegates to ${helper}`, () => {
    assert.equal(audioPlayer.includes(helper), true);
  });
}

test("AudioPlayer no longer performs raw numeric coercion in handlers", () => {
  assert.equal(audioPlayer.includes("Number(value)"), false);
});

test("theme storage reads are guarded", () => {
  assert.equal(theme.includes("export function readStoredTheme"), true);
  assert.equal(theme.includes("catch"), true);
});

test("theme storage writes are guarded", () => {
  assert.equal(theme.includes("export function writeStoredTheme"), true);
  assert.equal(theme.includes("storage?.setItem?."), true);
});

test("routes use stable path keys", () => {
  assert.equal(routes.includes("key={path}"), true);
  assert.equal(routes.includes("key={index}"), false);
});

test("application contains no direct interpolated err.message", () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:js|jsx)$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(root, "src"));
  const offenders = files
    .filter((file) =>
      /\$\{\s*(?:err|error)\.message\s*\}/.test(fs.readFileSync(file, "utf8"))
    )
    .map((file) => path.relative(root, file));
  assert.deepEqual(offenders, []);
});
