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
; Models are compressed once by the smart builder and extracted during install.
Source: "{src}\models.7z"; DestDir: "{tmp}"; Flags: external ignoreversion deleteafterinstall
Source: "{src}\7zr.exe"; DestDir: "{tmp}"; Flags: external ignoreversion deleteafterinstall
Source: "{src}\msst\*"; DestDir: "{app}\resources\backend\_internal\engines\msst"; Flags: external ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Запустить {#MyAppName}"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent

[Code]
var
  ThemePage: TInputOptionWizardPage;

procedure ApplyInstallerTheme;
begin
  if ThemePage.SelectedValueIndex = 1 then
  begin
    WizardForm.Color := $F4F4F4;
    WizardForm.MainPanel.Color := $FFFFFF;
  end
  else if ThemePage.SelectedValueIndex = 2 then
  begin
    WizardForm.Color := $18301D;
    WizardForm.MainPanel.Color := $24482C;
  end
  else if ThemePage.SelectedValueIndex = 3 then
  begin
    WizardForm.Color := $2E1838;
    WizardForm.MainPanel.Color := $452253;
  end
  else
  begin
    WizardForm.Color := $1C1A24;
    WizardForm.MainPanel.Color := $282433;
  end;
end;

procedure ThemeChanged(Sender: TObject);
begin
  ApplyInstallerTheme;
end;

procedure InitializeWizard;
begin
  ThemePage := CreateInputOptionPage(
    wpSelectDir,
    'Оформление A&D Voice',
    'Выберите начальную тему программы',
    'Позже тему можно изменить в настройках.',
    True,
    False
  );
  ThemePage.Add('Тёмная');
  ThemePage.Add('Светлая');
  ThemePage.Add('Зелёная');
  ThemePage.Add('Фиолетовая');
  ThemePage.SelectedValueIndex := 0;
  ThemePage.CheckListBox.OnClickCheck := @ThemeChanged;
  ApplyInstallerTheme;
end;

function SelectedTheme: String;
begin
  case ThemePage.SelectedValueIndex of
    1: Result := 'light';
    2: Result := 'green';
    3: Result := 'violet';
  else
    Result := 'dark';
  end;
end;

procedure WriteInitialPreferences;
var
  SettingsDir: String;
  SettingsPath: String;
  Payload: String;
begin
  SettingsDir := ExpandConstant('{userappdata}\A&D Voice\backend-data');
  SettingsPath := SettingsDir + '\settings.json';
  if FileExists(SettingsPath) then
    Exit;
  ForceDirectories(SettingsDir);
  Payload := '{' + #13#10 +
    '  "language": "uk",' + #13#10 +
    '  "theme": "' + SelectedTheme + '",' + #13#10 +
    '  "compute_mode": "auto"' + #13#10 +
    '}' + #13#10;
  if not SaveStringToFile(SettingsPath, Payload, False) then
    RaiseException('Не удалось сохранить начальные настройки программы.');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  TarExe: String;
  ArchivePath: String;
  ModelsArchivePath: String;
  SevenZipPath: String;
begin
  if CurStep = ssPostInstall then
  begin
    WriteInitialPreferences;
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

    ModelsArchivePath := ExpandConstant('{tmp}\models.7z');
    SevenZipPath := ExpandConstant('{tmp}\7zr.exe');
    ForceDirectories(ExpandConstant('{app}\resources\backend\_internal\models'));
    if not Exec(
      SevenZipPath,
      'x -y -o"' + ExpandConstant('{app}\resources\backend\_internal\models') + '" "' + ModelsArchivePath + '"',
      '',
      SW_HIDE,
      ewWaitUntilTerminated,
      ResultCode
    ) then
      RaiseException('Could not start AI model extraction.');
    if ResultCode <> 0 then
      RaiseException('AI model extraction failed. Exit code: ' + IntToStr(ResultCode));
  end;
end;
