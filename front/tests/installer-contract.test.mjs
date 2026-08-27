import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "vitest";
const read = (file) => fs.readFileSync(file, "utf8");
const installer = read("../scripts/karaoke-studio.iss");
const electronMain = read("electron/main.cjs");
const preload = read("electron/preload.cjs");
const installerBuilder = read("../scripts/build-installer.ps1");
const releaseManifest = read("../scripts/generate-release-manifest.ps1");
const matches = (source, patterns) => patterns.forEach((pattern) => assert.match(source, pattern));
const excludes = (source, patterns) => patterns.forEach((pattern) => assert.doesNotMatch(source, pattern));
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
    /\{app\}\\data\\generated/,
    /\{app\}\\data\\logs/,
    /DestDir: "\{app\}\\\.install"/,
    /CopyFile\(SelectedIconPath\(''\), ThemeIconPath, False\)/,
    /их можно будет скачать позже в настройках A&D Voice/,
    /Check: EnsureApplicationExecutable/,
    /function EnsureApplicationExecutable: Boolean/
  ]);
  excludes(installer, [/\{localappdata\}\\A&D Voice|\{userappdata\}\\A&D Voice/, /ThemeIconPreviewsDir|TBitmapImage/]);
  matches(electronMain, [/--advoice-theme=\$\{initialTheme\}/]);
  matches(preload, [/initialTheme/]);
});
test("installer language selection drives Inno's own wizard localization", () => {
  matches(installer, [
    /^ShowLanguageDialog=auto$/m,
    /^UsePreviousLanguage=yes$/m,
    /function ActiveLanguageComboIndex: Integer;/,
    /LanguageCombo\.ItemIndex := ActiveLanguageComboIndex;/
  ]);
});
test("installer updates preserve preferences and skip first-install choices", () => {
  matches(installer, [
    /UpdateInstall: Boolean;/,
    /procedure ReadExistingPreferences\(const InstallDir: String\);/,
    /InstallDir := WizardDirValue;/,
    /ReadExistingPreferences\(InstallDir\);/,
    /selected-theme\.txt/,
    /install-preferences\.json/,
    /function ShouldSkipPage\(PageID: Integer\): Boolean;/,
    /PageID = PreferencesPage\.ID/,
    /if not UpdateInstall then\s+WriteInitialPreferences;/,
    /if UpdateInstall then\s+begin\s+CompleteInstallProgress;/,
    /Tasks: desktopicon; Check: IsFreshInstall/,
    /Name: "desktopicon";[^\n]+Check: IsFreshInstall/
  ]);
  const initializeWizard = installer.match(/procedure InitializeWizard;[\s\S]*?\nend;/)?.[0] || "";
  assert.doesNotMatch(initializeWizard, /ExpandConstant\('\{app\}/);
});
test("installer run changes keep every generated report in the current run", () => {
  matches(installerBuilder, [
    /\$script:ManifestFile = Join-Path \$resolved "release-manifest\.json"/,
    /\$script:SizeReportFile = Join-Path \$resolved "size-report\.json"/,
    /\$ChecksumScript,\s+\$ManifestScript,\s+\$SizeReportScript/,
    /@\(\$InstallerExe,\$ChecksumFile,\$ManifestFile,\$SizeReportFile\)/
  ]);
  matches(releaseManifest, [
    /GetDirectoryName\(\[IO\.Path\]::GetFullPath\(\$OutputFile\)\)/,
    /\[IO\.Directory\]::CreateDirectory\(\$outputDirectory\)/
  ]);
});
test("installer window toggles native fullscreen through the trusted IPC boundary", () => {
  matches(electronMain, [
    /handleTrustedIpc\("window:toggleFullscreen"/,
    /mainWindow\.setFullScreen\(!mainWindow\.isFullScreen\(\)\)/,
    /"enter-full-screen"/,
    /"leave-full-screen"/
  ]);
  matches(preload, [/toggleFullscreen: \(\) => ipcRenderer\.invoke\("window:toggleFullscreen"\)/, /onFullscreenChange/]);
});
