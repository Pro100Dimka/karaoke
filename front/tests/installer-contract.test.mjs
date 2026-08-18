import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "vitest";
const read = (file) => fs.readFileSync(file, "utf8");
const installer = read("../scripts/karaoke-studio.iss");
const electronMain = read("electron/main.cjs");
const preload = read("electron/preload.cjs");
const matches = (source, patterns) => patterns.forEach((pattern) => assert.match(source, pattern));
const excludes = (source, patterns) =>
  patterns.forEach((pattern) => assert.doesNotMatch(source, pattern));
test("installer theme and optional-model handoff remain wired", () => {
  matches(installer, [
    /InstallModelsCheck\.Checked := True/,
    /if not InstallModelsCheck\.Checked then/,
    /install-preferences\.json/,
    /selected-theme\.txt/,
    /selected-theme\.ico/,
    /^DefaultDirName=\{code:GetDefaultDir\}$/m,
    /function GetDefaultDir\(Param: String\): String;/,
    /Result := ExpandConstant\('\{userdocs\}\\\{#MyAppName\}'\);/,
    /for Drive := Ord\('D'\) to Ord\('Z'\) do/,
    /DrivePath := Chr\(Drive\) \+ ':\\';/,
    /DrivePath <> ExpandConstant\('\{sd\}\\'\)/,
    /Result := DrivePath \+ '\{#MyAppName\}';/,
    /\{app\}\\data\\backend/,
    /\{app\}\\data\\models/,
    /\{app\}\\data\\cache/,
    /\{app\}\\data\\logs/,
    /DestDir: "\{app\}\\\.install"/,
    /FileCopy\(SelectedIconPath\(''\), ThemeIconPath, False\)/,
    /их можно будет скачать позже в настройках A&D Voice/,
    /Check: EnsureApplicationExecutable/,
    /function EnsureApplicationExecutable: Boolean/
  ]);
  excludes(installer, [
    /\{localappdata\}\\A&D Voice|\{userappdata\}\\A&D Voice/,
    /ThemeIconPreviewsDir|TBitmapImage/
  ]);
  matches(electronMain, [/--advoice-theme=\$\{initialTheme\}/]);
  matches(preload, [/initialTheme/]);
});
test("installer language selection drives Inno's own wizard localization", () => {
  matches(installer, [
    /^ShowLanguageDialog=yes$/m,
    /function ActiveLanguageComboIndex: Integer;/,
    /LanguageCombo\.ItemIndex := ActiveLanguageComboIndex;/
  ]);
});
test("installer window toggles native fullscreen through the trusted IPC boundary", () => {
  matches(electronMain, [
    /handleTrustedIpc\("window:toggleFullscreen"/,
    /mainWindow\.setFullScreen\(!mainWindow\.isFullScreen\(\)\)/,
    /"enter-full-screen"/,
    /"leave-full-screen"/
  ]);
  matches(preload, [
    /toggleFullscreen: \(\) => ipcRenderer\.invoke\("window:toggleFullscreen"\)/,
    /onFullscreenChange/
  ]);
});
