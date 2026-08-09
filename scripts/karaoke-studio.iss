#ifndef MyAppName
  #define MyAppName "A&D Voice"
#endif

#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif

#ifndef MyAppExeName
  #define MyAppExeName "A&D Voice.exe"
#endif

#ifndef MyAppId
  #define MyAppId "E734496E-2622-5565-89D3-45451D9DE7EE"
#endif

#ifndef SourceDir
  #error SourceDir is not defined
#endif

#ifndef OutputDir
  #error OutputDir is not defined
#endif

#ifndef SetupIcon
  #error SetupIcon is not defined
#endif

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher=A&D Voice
AppCopyright=Copyright (C) 2026 A&D Voice
VersionInfoCompany=A&D Voice
VersionInfoDescription=A&D Voice offline karaoke studio
VersionInfoProductName=A&D Voice
VersionInfoProductVersion={#MyAppVersion}
VersionInfoVersion={#MyAppVersion}

DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes

OutputDir={#OutputDir}
OutputBaseFilename=A&D Voice Setup {#MyAppVersion}

ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog

WizardStyle=modern
WizardResizable=no
SetupIconFile={#SetupIcon}
MinVersion=10.0.17763

Compression=lzma2/fast
SolidCompression=no

; The complete offline package is larger than the 4.2 GB single-setup limit.
; Keep every generated Setup-*.bin beside Setup.exe when distributing it.
DiskSpanning=yes
DiskSliceSize=max
SlicesPerDisk=1


SetupLogging=yes
CloseApplications=yes
RestartApplications=no
UsePreviousAppDir=yes
UsePreviousLanguage=yes

UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "ukrainian"; MessagesFile: "compiler:Languages\Ukrainian.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Создать ярлык на рабочем столе"; GroupDescription: "Дополнительные ярлыки:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Excludes: "resources\media\videoplayback.webm"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceDir}\resources\media\videoplayback.webm"; DestDir: "{app}\resources\media"; Flags: ignoreversion nocompression

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Запустить {#MyAppName}"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent
