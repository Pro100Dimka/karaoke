import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "vitest";

const installer = fs.readFileSync("../scripts/karaoke-studio.iss", "utf8");
const electronMain = fs.readFileSync("electron/main.cjs", "utf8");
const preload = fs.readFileSync("electron/preload.cjs", "utf8");

test("installer theme and optional-model handoff remain wired", () => {
  assert.match(installer, /InstallModelsCheck\.Checked := True/);
  assert.match(installer, /if not InstallModelsCheck\.Checked then/);
  assert.match(installer, /install-preferences\.json/);
  assert.match(installer, /selected-theme\.txt/);
  assert.match(installer, /selected-theme\.ico/);
  assert.match(installer, /^DefaultDirName=\{userdocs\}\\\{#MyAppName\}$/m);
  assert.match(installer, /\{app\}\\data\\backend/);
  assert.match(installer, /\{app\}\\data\\models/);
  assert.match(installer, /\{app\}\\data\\cache/);
  assert.match(installer, /\{app\}\\data\\logs/);
  assert.match(installer, /DestDir: "\{app\}\\\.install"/);
  assert.doesNotMatch(installer, /\{localappdata\}\\A&D Voice|\{userappdata\}\\A&D Voice/);
  assert.match( installer, /FileCopy\(SelectedIconPath\(''\), ThemeIconPath, False\)/
  );
  assert.match( installer, /их можно будет скачать позже в настройках A&D Voice/
  );
  assert.doesNotMatch(installer, /ThemeIconPreviewsDir|TBitmapImage/);
  assert.match(installer, /Check: EnsureApplicationExecutable/);
  assert.match(installer, /function EnsureApplicationExecutable: Boolean/);
  assert.match(electronMain, /--advoice-theme=\$\{initialTheme\}/);
  assert.match(preload, /initialTheme/);
});
