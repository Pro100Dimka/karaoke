import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "vitest";
const read = (file) => fs.readFileSync(file, "utf8");
const installer = read("../scripts/karaoke-studio.iss");
const electronMain = read("electron/main.cjs");
const preload = read("electron/preload.cjs");
const installerBuilder = read("../scripts/build-installer.ps1");
const packageConfig = JSON.parse(read("package.json"));
const releaseManifest = read("../scripts/generate-release-manifest.ps1");
const sizeReport = read("../scripts/generate-size-report.ps1");
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
test("uninstall removes every runtime entry while preserving user data by default", () => {
  matches(installer, [
    /procedure DeleteApplicationFilesExceptData;/,
    /CompareText\(FindRec\.Name, 'data'\) <> 0/,
    /DelTree\(EntryPath, True, True, True\)/,
    /if RemoveUserData then\s+DelTree\(ExpandConstant\('\{app\}\\data'\), True, True, True\);/,
    /DeleteApplicationFilesExceptData;/
  ]);
  excludes(installer, [/^\[UninstallDelete\]$/m, /Name: "\{app\}\\chrome_100_percent\.pak"/]);
});
test("installer run changes keep every generated report in the current run", () => {
  matches(installerBuilder, [
    /\$script:ManifestFile = Join-Path \$resolved "release-manifest\.json"/,
    /\$script:SizeReportFile = Join-Path \$resolved "size-report\.json"/,
    /\$script:SbomFile = Join-Path \$resolved "release\.cdx\.json"/,
    /\$ChecksumScript,\s+\$ManifestScript,\s+\$SizeReportScript/,
    /@\(\$InstallerExe,\$ChecksumFile,\$ManifestFile,\$SizeReportFile,\$SbomFile\)/
  ]);
  matches(releaseManifest, [
    /GetDirectoryName\(\[IO\.Path\]::GetFullPath\(\$OutputFile\)\)/,
    /\[IO\.Directory\]::CreateDirectory\(\$outputDirectory\)/
  ]);
});
test("every installer path generates, hashes and publishes the aggregate SBOM", () => {
  assert.equal((installerBuilder.match(/Create-ReleaseSbom\s+Create-Checksums/g) ?? []).length, 2);
  matches(installerBuilder, [
    /function Create-ReleaseSbom/,
    /unknown licenses block the release/,
    /Copy-Item -LiteralPath \$GeneratedSbomFile -Destination \$SbomFile -Force/,
    /Require-File \$SbomFile "Release SBOM artifact"/,
    /New-IsoHardLink\s+`\s+\$SbomFile\s+`\s+\(Join-Path \$IsoView "release\.cdx\.json"\)/
  ]);
  matches(releaseManifest, [
    /\[Parameter\(Mandatory = \$true\)\]\s+\[string\] \$SbomFile/,
    /Mandatory release SBOM does not exist/,
    /sha256 = \(\[BitConverter\]::ToString\(\$sha\.ComputeHash\(\$stream\)\)\)/
  ]);
});
test("release manifest hashing works without the optional Get-FileHash cmdlet", () => {
  excludes(releaseManifest, [/Get-FileHash/]);
  excludes(sizeReport, [/Get-FileHash/]);
  matches(releaseManifest, [
    /function Get-Sha256Hex/,
    /\[Security\.Cryptography\.SHA256\]::Create\(\)/,
    /Get-Sha256Hex \$_\.FullName/
  ]);
  matches(sizeReport, [
    /function Get-Sha256Hex/,
    /\[Security\.Cryptography\.SHA256\]::Create\(\)/,
    /Get-Sha256Hex \$file\.FullName/
  ]);
});
test("Inno is the only production installer and electron-builder is runtime-only", () => {
  assert.equal(packageConfig.scripts["build:electron"], undefined);
  assert.equal(packageConfig.build.win.target, "dir");
  assert.equal(packageConfig.build.nsis, undefined);
  assert.equal(packageConfig.build.mac, undefined);
  assert.equal(packageConfig.build.linux, undefined);
  matches(installerBuilder, [
    /electron-builder\s+`\s+--win\s+`\s+--x64\s+`\s+--dir/,
    /\$InnoTemplate = Join-Path \$Root "scripts\\karaoke-studio\.iss"/,
    /function Build-Installer/,
  ]);
});
test("packaged backend and release manifest share one version and build identity", () => {
  matches(installerBuilder, [
    /\$AppVersion = \(Get-Content[^\n]*Join-Path \$Root "VERSION"/,
    /\$ReleaseBuildId = ""[\s\S]*GITHUB_SHA[\s\S]*git -C \$Root rev-parse HEAD/,
    /function Write-BackendBuildIdentity[\s\S]*build-identity\.json/,
    /-OutputFile \$ManifestFile\s+`\s+-BuildId \$ReleaseBuildId/
  ]);
});
test("clean builds tolerate locked stale Electron runs", () => {
  matches(installerBuilder, [
    /\[switch\]\$AllowLockedRemainder/,
    /Remove-Directory \$Build -AllowLockedRemainder/,
    /Locked stale build files were left in place/
  ]);
});
test("clean release validation happens before source version mutation", () => {
  const gate = installerBuilder.indexOf('Write-Host "Running mandatory release gate..."');
  const mutation = installerBuilder.indexOf("& $Python $VersionSync --set $NextVersion");
  assert.ok(gate >= 0 && mutation >= 0 && gate < mutation);
  assert.match(
    installerBuilder,
    /Validate the exact checked-out source before a clean build changes any\s+# version-bearing manifest/,
  );
});
test("clean builds synchronize every version mirror from the canonical VERSION file", () => {
  matches(installerBuilder, [
    /\$VersionFile = Join-Path \$Root "VERSION"/,
    /\$CurrentVersion = \(Get-Content -LiteralPath \$VersionFile -Raw\)\.Trim\(\)/,
    /\$VersionSync = Join-Path \$Root "scripts\\sync_version\.py"/,
    /& \$Python \$VersionSync --set \$NextVersion/,
    /\$AppVersion = \(Get-Content -LiteralPath \(Join-Path \$Root "VERSION"\) -Raw\)\.Trim\(\)/,
  ]);
  excludes(installerBuilder, [
    /WriteAllText\(\$PackageJsonPath/,
    /WriteAllText\(\$PyprojectPath/,
    /WriteAllText\(\$DiagnosticsPath/,
  ]);
});
test("clean releases force a fresh gate and restore the caller environment", () => {
  matches(installerBuilder, [
    /\$PreviousReleaseFull = \$env:KARAOKE_RELEASE_FULL/,
    /if \(\$Mode -eq "clean"\) \{ \$env:KARAOKE_RELEASE_FULL = "1" \}/,
    /Remove-Item Env:KARAOKE_RELEASE_FULL -ErrorAction SilentlyContinue/,
    /\$env:KARAOKE_RELEASE_FULL = \$PreviousReleaseFull/,
  ]);
});
test("developer no-checks clean builds do not require a signing certificate", () => {
  matches(installerBuilder, [
    /if \(\$Mode -eq "clean" -and -not \$SkipReleaseGate\) \{ \$arguments \+= "-Required" \}/,
  ]);
  assert.doesNotMatch(
    installerBuilder,
    /if \(\$Mode -eq "clean"\) \{ \$arguments \+= "-Required" \}/,
  );
});
test("native build toolchain is discovered across Visual Studio editions", () => {
  matches(installerBuilder, [
    /function Find-VisualStudioInstallation/,
    /\$env:ADVOICE_VS_PATH/,
    /Microsoft Visual Studio\\Installer\\vswhere\.exe/,
    /-products \*/,
    /Microsoft\.VisualStudio\.Component\.VC\.Tools\.x86\.x64/,
    /Microsoft\.VisualStudio\.Component\.VC\.CMake\.Project/,
    /\$Vs = Find-VisualStudioInstallation/,
  ]);
  excludes(installerBuilder, [/\$Vs = "C:\\Program Files \(x86\)\\Microsoft Visual Studio\\2022\\BuildTools"/]);
});
test("incremental build cache verifies output size and SHA-256 before skipping", () => {
  matches(installerBuilder, [
    /build-output-manifest-v2-sha256-archive-check/,
    /function Get-OutputManifestJson/,
    /function Get-FileSha256/,
    /function Test-ArchiveIntegrity/,
    /& \$tar -tf \$Path/,
    /\$sha\.ComputeHash\(\$stream\)/,
    /Get-OutputStatePath \$Name/,
    /output integrity state missing/,
    /cached output changed or corrupted/,
    /\$savedOutputs -ne \$actualOutputs/,
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
test("desktop window bounds survive restart and disconnected displays", () => {
  matches(electronMain, [
    /readWindowState\(fs, WINDOW_STATE_PATH\)/,
    /clampWindowBounds\(bounds, displayWorkAreas\(\)/,
    /screen\.on\("display-removed", ensureWindowIsVisible\)/,
    /screen\.on\("display-metrics-changed", ensureWindowIsVisible\)/,
    /mainWindow\.on\("close", persistWindowState\)/
  ]);
});
