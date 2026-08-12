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
#ifndef InstallerBackground
  #error InstallerBackground is required
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
Source: "{#InstallerBackground}"; Flags: dontcopy
; Runtime is already compressed once. Inno only copies the archive from ISO.
Source: "{src}\app-runtime.zip"; DestDir: "{tmp}"; Flags: external ignoreversion deleteafterinstall
Source: "{src}\msst\*"; DestDir: "{app}\resources\backend\_internal\engines\msst"; Flags: external ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Запустить {#MyAppName}"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; app-runtime.zip is extracted by tar, so register every installer-owned root
; explicitly. User songs/settings are outside {app} and are handled separately.
Type: filesandordirs; Name: "{app}\locales"
Type: filesandordirs; Name: "{app}\resources"
Type: files; Name: "{app}\{#MyAppExeName}"
Type: files; Name: "{app}\chrome_100_percent.pak"
Type: files; Name: "{app}\chrome_200_percent.pak"
Type: files; Name: "{app}\d3dcompiler_47.dll"
Type: files; Name: "{app}\dxcompiler.dll"
Type: files; Name: "{app}\dxil.dll"
Type: files; Name: "{app}\ffmpeg.dll"
Type: files; Name: "{app}\icudtl.dat"
Type: files; Name: "{app}\libEGL.dll"
Type: files; Name: "{app}\libGLESv2.dll"
Type: files; Name: "{app}\LICENSE.electron.txt"
Type: files; Name: "{app}\LICENSES.chromium.html"
Type: files; Name: "{app}\resources.pak"
Type: files; Name: "{app}\snapshot_blob.bin"
Type: files; Name: "{app}\v8_context_snapshot.bin"
Type: files; Name: "{app}\vk_swiftshader.dll"
Type: files; Name: "{app}\vk_swiftshader_icd.json"
Type: files; Name: "{app}\vulkan-1.dll"
; Remove any generated logs, update remnants or files created after setup.
; {app} is the dedicated application directory selected by the user.
Type: filesandordirs; Name: "{app}"

[Code]
var
  ThemePage: TInputOptionWizardPage;
  InstallingBackground: TBitmapImage;
  RemoveUserData: Boolean;

function InitializeUninstall: Boolean;
begin
  RemoveUserData :=
    MsgBox(
      'Удалить также настройки, кэш, библиотеку песен и записи пользователя?',
      mbConfirmation,
      MB_YESNO
    ) = IDYES;
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and RemoveUserData then
  begin
    DelTree(ExpandConstant('{localappdata}\A&D Voice'), True, True, True);
    DelTree(ExpandConstant('{userappdata}\A&D Voice'), True, True, True);
  end;
end;

procedure ApplyInstallerTheme;
var
  BackgroundColor: TColor;
  PanelColor: TColor;
  TextColor: TColor;
begin
  if ThemePage.SelectedValueIndex = 1 then
  begin
    BackgroundColor := $F4F4F4;
    PanelColor := $FFFFFF;
    TextColor := $202020;
  end
  else if ThemePage.SelectedValueIndex = 2 then
  begin
    BackgroundColor := $18301D;
    PanelColor := $24482C;
    TextColor := $F2FFF4;
  end
  else if ThemePage.SelectedValueIndex = 3 then
  begin
    BackgroundColor := $2E1838;
    PanelColor := $452253;
    TextColor := $FFF3FF;
  end
  else
  begin
    BackgroundColor := $08090D;
    PanelColor := $241018;
    TextColor := $FFFFFF;
  end;
  WizardForm.Color := BackgroundColor;
  WizardForm.MainPanel.Color := PanelColor;
  WizardForm.WelcomePage.Color := BackgroundColor;
  WizardForm.FinishedPage.Color := BackgroundColor;
  ThemePage.Surface.Color := BackgroundColor;
  ThemePage.CheckListBox.Color := PanelColor;
  ThemePage.CheckListBox.Font.Color := TextColor;
  WizardForm.PageNameLabel.Font.Color := TextColor;
  WizardForm.PageDescriptionLabel.Font.Color := TextColor;
  WizardForm.StatusLabel.Font.Color := TextColor;
  InstallingBackground.Visible := ThemePage.SelectedValueIndex = 0;
end;

procedure ThemeChanged(Sender: TObject);
begin
  ApplyInstallerTheme;
end;

procedure InitializeWizard;
begin
  ExtractTemporaryFile(ExtractFileName('{#InstallerBackground}'));
  InstallingBackground := TBitmapImage.Create(WizardForm.InstallingPage);
  InstallingBackground.Parent := WizardForm.InstallingPage;
  InstallingBackground.SetBounds(
    0,
    0,
    WizardForm.InstallingPage.ClientWidth,
    WizardForm.InstallingPage.ClientHeight
  );
  InstallingBackground.Stretch := True;
  InstallingBackground.PngImage.LoadFromFile(
    ExpandConstant('{tmp}\') + ExtractFileName('{#InstallerBackground}')
  );
  InstallingBackground.SendToBack;

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

procedure ShowPendingInstallStep(const Status: String);
begin
  WizardForm.StatusLabel.Caption := Status;
  WizardForm.ProgressGauge.Position := 0;
  WizardForm.ProgressGauge.Style := npbstMarquee;
end;

procedure CompleteInstallProgress;
begin
  WizardForm.ProgressGauge.Style := npbstNormal;
  WizardForm.ProgressGauge.Position := WizardForm.ProgressGauge.Max;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  TarExe: String;
  ArchivePath: String;
  BackendExe: String;
  ModelsDir: String;
  ModelCacheDir: String;
begin
  if CurStep = ssPostInstall then
  begin
    WriteInitialPreferences;
    TarExe := ExpandConstant('{sys}\tar.exe');
    ArchivePath := ExpandConstant('{tmp}\app-runtime.zip');

    ShowPendingInstallStep(
      'Этап 2 из 3: распаковка программы. Установка ещё не завершена...'
    );

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

    BackendExe := ExpandConstant('{app}\resources\backend\KaraokeBackend.exe');
    ModelsDir := ExpandConstant('{app}\resources\backend\_internal\models');
    ModelCacheDir := ExpandConstant('{tmp}\huggingface-cache');
    ForceDirectories(ModelsDir);
    ShowPendingInstallStep(
      'Этап 3 из 3: загрузка AI-моделей. Полоса движется до полного завершения...'
    );
    if not Exec(
      BackendExe,
      '--install-ai-models --models-root "' + ModelsDir +
        '" --cache-dir "' + ModelCacheDir + '" --workers 4',
      ExpandConstant('{app}\resources\backend'),
      SW_HIDE,
      ewWaitUntilTerminated,
      ResultCode
    ) then
      RaiseException('Не удалось запустить загрузку AI-моделей.');
    if ResultCode <> 0 then
      RaiseException(
        'Не удалось загрузить AI-модели. Проверьте подключение к интернету и повторите установку. Код: ' +
        IntToStr(ResultCode)
      );
    CompleteInstallProgress;
    WizardForm.StatusLabel.Caption := 'Установка A&D Voice завершена.';
  end;
end;
