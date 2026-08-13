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
#ifndef ThemeIconsDir
  #error ThemeIconsDir is required
#endif
#ifndef ThemeIconPreviewsDir
  #error ThemeIconPreviewsDir is required
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
ShowLanguageDialog=no
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
Source: "{#ThemeIconsDir}\dark.ico"; DestDir: "{app}\theme-icons"; Flags: ignoreversion
Source: "{#ThemeIconsDir}\light.ico"; DestDir: "{app}\theme-icons"; Flags: ignoreversion
Source: "{#ThemeIconsDir}\green.ico"; DestDir: "{app}\theme-icons"; Flags: ignoreversion
Source: "{#ThemeIconsDir}\violet.ico"; DestDir: "{app}\theme-icons"; Flags: ignoreversion
Source: "{#ThemeIconPreviewsDir}\dark.png"; Flags: dontcopy
Source: "{#ThemeIconPreviewsDir}\light.png"; Flags: dontcopy
Source: "{#ThemeIconPreviewsDir}\green.png"; Flags: dontcopy
Source: "{#ThemeIconPreviewsDir}\violet.png"; Flags: dontcopy
; Runtime is already compressed once. Inno only copies the archive from ISO.
Source: "{src}\app-runtime.zip"; DestDir: "{tmp}"; Flags: external ignoreversion deleteafterinstall
Source: "{src}\msst\*"; DestDir: "{app}\resources\backend\_internal\engines\msst"; Flags: external ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{code:SelectedIconPath}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{code:SelectedIconPath}"; Tasks: desktopicon

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
; AI weights are reusable while the app is installed, but are not user-created
; content and must never leave ~10 GB behind after uninstall.
Type: filesandordirs; Name: "{localappdata}\A&D Voice\models"
Type: filesandordirs; Name: "{localappdata}\A&D Voice\model-cache"

[Code]
var
  PreferencesPage: TWizardPage;
  LanguageCombo: TNewComboBox;
  ThemeCombo: TNewComboBox;
  ThemePreview: TBitmapImage;
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

function SelectedTheme: String; forward;

procedure ThemeChanged(Sender: TObject);
var
  PreviewPath: String;
begin
  PreviewPath := ExpandConstant('{tmp}\') + SelectedTheme + '.png';
  ThemePreview.PngImage.LoadFromFile(PreviewPath);
end;

procedure InitializeWizard;
var
  LanguageLabel: TNewStaticText;
  ThemeLabel: TNewStaticText;
begin
  ExtractTemporaryFile('dark.png');
  ExtractTemporaryFile('light.png');
  ExtractTemporaryFile('green.png');
  ExtractTemporaryFile('violet.png');

  PreferencesPage := CreateCustomPage(
    wpSelectDir,
    'Язык и тема A&D Voice',
    'Выберите язык программы и начальную тему. Позже их можно изменить в настройках.'
  );

  LanguageLabel := TNewStaticText.Create(PreferencesPage);
  LanguageLabel.Parent := PreferencesPage.Surface;
  LanguageLabel.Caption := 'Язык программы';
  LanguageLabel.SetBounds(0, 12, ScaleX(220), ScaleY(20));
  LanguageCombo := TNewComboBox.Create(PreferencesPage);
  LanguageCombo.Parent := PreferencesPage.Surface;
  LanguageCombo.Style := csDropDownList;
  LanguageCombo.SetBounds(0, 36, ScaleX(260), ScaleY(24));
  LanguageCombo.Items.Add('Українська');
  LanguageCombo.Items.Add('Русский');
  LanguageCombo.Items.Add('English');
  LanguageCombo.ItemIndex := 0;

  ThemeLabel := TNewStaticText.Create(PreferencesPage);
  ThemeLabel.Parent := PreferencesPage.Surface;
  ThemeLabel.Caption := 'Тема и иконка';
  ThemeLabel.SetBounds(0, 84, ScaleX(220), ScaleY(20));
  ThemeCombo := TNewComboBox.Create(PreferencesPage);
  ThemeCombo.Parent := PreferencesPage.Surface;
  ThemeCombo.Style := csDropDownList;
  ThemeCombo.SetBounds(0, 108, ScaleX(260), ScaleY(24));
  ThemeCombo.Items.Add('Тёмная');
  ThemeCombo.Items.Add('Светлая');
  ThemeCombo.Items.Add('Зелёная');
  ThemeCombo.Items.Add('Фиолетовая');
  ThemeCombo.ItemIndex := 0;
  ThemeCombo.OnChange := @ThemeChanged;

  ThemePreview := TBitmapImage.Create(PreferencesPage);
  ThemePreview.Parent := PreferencesPage.Surface;
  ThemePreview.SetBounds(ScaleX(290), ScaleY(82), ScaleX(96), ScaleY(96));
  ThemePreview.Stretch := True;
  ThemeChanged(nil);
end;

function SelectedTheme: String;
begin
  case ThemeCombo.ItemIndex of
    1: Result := 'light';
    2: Result := 'green';
    3: Result := 'violet';
  else
    Result := 'dark';
  end;
end;

function SelectedLanguage: String;
begin
  case LanguageCombo.ItemIndex of
    1: Result := 'ru';
    2: Result := 'en';
  else
    Result := 'uk';
  end;
end;

function SelectedIconPath(Param: String): String;
begin
  Result := ExpandConstant('{app}\theme-icons\') + SelectedTheme + '.ico';
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
    '  "language": "' + SelectedLanguage + '",' + #13#10 +
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
  ModelLogPath: String;
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
    { Store downloads outside {app}: Inno rollback must not erase completed }
    { multi-gigabyte files after a transient network failure. }
    ModelsDir := ExpandConstant('{localappdata}\A&D Voice\models');
    ModelCacheDir := ExpandConstant('{localappdata}\A&D Voice\model-cache');
    ModelLogPath := ExpandConstant('{localappdata}\A&D Voice\logs\model-install.log');
    ForceDirectories(ModelsDir);
    ShowPendingInstallStep(
      'Этап 3 из 3: загрузка AI-моделей. Это индикатор активности, а не проценты...'
    );
    if not Exec(
      BackendExe,
      '--install-ai-models --models-root "' + ModelsDir +
        '" --cache-dir "' + ModelCacheDir + '" --workers 2 --retries 3' +
        ' --log-file "' + ModelLogPath + '"',
      ExpandConstant('{app}\resources\backend'),
      SW_HIDE,
      ewWaitUntilTerminated,
      ResultCode
    ) then
      RaiseException('Не удалось запустить загрузку AI-моделей.');
    if ResultCode <> 0 then
      RaiseException(
        'Не удалось загрузить одну из AI-моделей. Уже загруженные файлы сохранены,' + #13#10 +
        'поэтому повторная установка продолжит загрузку, а не начнёт её заново.' + #13#10#13#10 +
        'Код: ' + IntToStr(ResultCode) + #13#10 +
        'Подробный лог: ' + ModelLogPath
      );
    CompleteInstallProgress;
    WizardForm.StatusLabel.Caption := 'Установка A&D Voice завершена.';
  end;
end;
