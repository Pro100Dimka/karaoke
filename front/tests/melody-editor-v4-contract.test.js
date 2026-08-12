import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const editor = fs.readFileSync("src/pages/Library/modals/song-settings/melody-editor.jsx", "utf8");
const loader = fs.readFileSync("src/components/backend-boot-loader.jsx", "utf8");
const app = fs.readFileSync("src/App.jsx", "utf8");
const css = fs.readFileSync("src/styles/app.css", "utf8");

test("backend boot loader waits for health before mounting application", () => {
  assert.match(loader, /await api\.getHealth\(\)/);
  assert.match(loader, /while \(!cancelled\)/);
  assert.match(app, /<BackendBootLoader>/);
  assert.match(loader, /darkIcon/);
  assert.match(loader, /lightIcon/);
  assert.match(loader, /violetIcon/);
  assert.match(loader, /greenIcon/);
});

test("editor keeps dual Cubase-like zoom controls without the retired left rail", () => {
  assert.doesNotMatch(editor, /melody-editor-control-rail/);
  assert.match(editor, /MoveHorizontal/);
  assert.match(editor, /MoveVertical/);
  assert.match(editor, /setVerticalZoom/);
  assert.match(css, /melody-editor-cubase-scrollbar/);
  assert.match(css, /melody-editor-inline-zoom/);
});

test("editor v4 renders layered piano keys and only one label owner per syllable", () => {
  assert.match(editor, /labelOwnerBySyllable/);
  assert.match(editor, /white-\$\{midi\}/);
  assert.match(editor, /black-\$\{midi\}/);
  assert.match(editor, /displayTextForNote\(note, syllableByIndex, labelOwnerBySyllable\)/);
  assert.match(css, /melody-editor-piano-key\.is-white/);
  assert.match(css, /melody-editor-piano-key\.is-black/);
});
