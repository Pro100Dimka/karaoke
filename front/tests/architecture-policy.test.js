import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "src");
const files = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (/\.(?:js|jsx)$/.test(entry.name)) files.push(fullPath);
  }
}
walk(sourceRoot);

const read = (file) => fs.readFileSync(file, "utf8");
const relative = (file) => path.relative(root, file).replaceAll("\\", "/");

test("source never destructures unknown caught values", () => {
  const offenders = files
    .filter((file) => /catch\s*\(\s*\{/.test(read(file)))
    .map(relative);
  assert.deepEqual(offenders, []);
});

test("route configuration does not use unstable array index keys", () => {
  const routes = read(path.join(sourceRoot, "components/routes.jsx"));
  assert.equal(/key=\{(?:index|i)\}/.test(routes), false);
  assert.equal(routes.includes("key={path}"), true);
});

test("localStorage access remains behind approved helpers", () => {
  const allow = new Set([
    "src/utils/theme.js",
    "src/utils/storage.js",
    "src/pages/Karaoke/utils/preferences.js"
  ]);
  const offenders = files
    .filter((file) => /(?:window\.|globalThis\.)?localStorage/.test(read(file)))
    .map(relative)
    .filter((file) => !allow.has(file));
  assert.deepEqual(offenders, []);
});

test("Library delegates song cards and toolbar actions", () => {
  const library = read(path.join(sourceRoot, "pages/Library/index.jsx"));
  assert.equal(library.includes("<LibrarySongCard"), true);
  assert.equal(library.includes("<LibraryActions"), true);
  assert.equal(library.includes("onPointerMove={(event)"), false);
  assert.equal(library.includes("<SongCardArtwork"), false);
});

test("settings form handles unknown errors through getErrorMessage", () => {
  const hook = read(path.join(sourceRoot, "hooks/useSettingsForm.js"));
  assert.equal(hook.includes("getErrorMessage(error)"), true);
  assert.equal(/catch\s*\(\s*\{/.test(hook), false);
});
