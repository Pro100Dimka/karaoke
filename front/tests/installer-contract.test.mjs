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
  assert.match(installer, /^DefaultDirName=\{code:GetDefaultDir\}$/m);
  // Installing on the system drive is the least convenient default for a
  // multi-gigabyte app plus its AI models; prefer any other drive when one
  // exists, and only fall back to the user's documents folder otherwise.
  assert.match(installer, /function GetDefaultDir\(Param: String\): String;/);
  assert.match(installer, /Result := ExpandConstant\('\{userdocs\}\\\{#MyAppName\}'\);/);
  assert.match(installer, /for Drive := 'D' to 'Z' do/);
  assert.match(installer, /Result := Drive \+ ':\\\{#MyAppName\}';/);
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

test("installer language selection drives Inno's own wizard localization", () => {
  // The custom language combo only ever wrote its choice to the installed
  // app's settings.json -- it never affected the installer's own wizard
  // text (Next/Back/Cancel, page titles, ...), so picking a different
  // language there had no visible effect until after installation.
  // ShowLanguageDialog=yes lets Inno's native dialog (shown before the
  // wizard starts) drive that localization automatically instead.
  assert.match(installer, /^ShowLanguageDialog=yes$/m);
  assert.match(installer, /function ActiveLanguageComboIndex: Integer;/);
  assert.match(installer, /LanguageCombo\.ItemIndex := ActiveLanguageComboIndex;/);
});

test("installer window toggles native fullscreen through the trusted IPC boundary", () => {
  assert.match(electronMain, /handleTrustedIpc\("window:toggleFullscreen"/);
  assert.match(electronMain, /mainWindow\.setFullScreen\(!mainWindow\.isFullScreen\(\)\)/);
  assert.match(electronMain, /"enter-full-screen"/);
  assert.match(electronMain, /"leave-full-screen"/);
  assert.match(preload, /toggleFullscreen: \(\) => ipcRenderer\.invoke\("window:toggleFullscreen"\)/);
  assert.match(preload, /onFullscreenChange/);
});
