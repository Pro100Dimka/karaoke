#ifndef MyAppName
  #error MyAppName is required
#endif
#ifndef MyAppVersion
  #error MyAppVersion is required
#endif
#ifndef MyAppExeName
  #error MyAppExeName is required
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif

[Setup]
AppId={{E734496E-2622-5565-89D3-45451D9DE7EE}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppName}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename={#MyAppName} Setup {#MyAppVersion}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
WizardStyle=modern
SetupIconFile={#SetupIcon}
Compression=none
SolidCompression=no
DiskSpanning=no
SetupLogging=yes
CloseApplications=yes
RestartApplications=no
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "ukrainian"; MessagesFile: "compiler:Languages\Ukrainian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Создать ярлык на рабочем столе"; GroupDescription: "Дополнительные ярлыки:"

[Files]
; Runtime is already compressed once. Inno only copies the archive from ISO.
Source: "{src}\app-runtime.zip"; DestDir: "{tmp}"; Flags: external ignoreversion deleteafterinstall
; AI payload remains raw/external for fast builds and installs.
Source: "{src}\models\*"; DestDir: "{app}\resources\backend\_internal\models"; Flags: external ignoreversion recursesubdirs createallsubdirs
Source: "{src}\msst\*"; DestDir: "{app}\resources\backend\_internal\engines\msst"; Flags: external ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Запустить {#MyAppName}"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  TarExe: String;
  ArchivePath: String;
begin
  if CurStep = ssPostInstall then
  begin
    TarExe := ExpandConstant('{sys}\tar.exe');
    ArchivePath := ExpandConstant('{tmp}\app-runtime.zip');

    if not FileExists(TarExe) then
      RaiseException('Windows tar.exe was not found. Windows 10/11 is required.');

    if not Exec(
      TarExe,
      '-xf "' + ArchivePath + '" -C "' + ExpandConstant('{app}') + '"',
      '',
      SW_HIDE,
      ewWaitUntilTerminated,
      ResultCode
    ) then
      RaiseException('Could not start runtime extraction.');

    if ResultCode <> 0 then
      RaiseException('Runtime extraction failed. Exit code: ' + IntToStr(ResultCode));

    if not FileExists(ExpandConstant('{app}\{#MyAppExeName}')) then
      RaiseException('Runtime extraction completed, but the application executable is missing.');
  end;
end;
