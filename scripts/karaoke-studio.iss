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

[Setup]
AppId={{E734496E-2622-5565-89D3-45451D9DE7EE}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppName}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename={#MyAppName} Setup {#MyAppVersion}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
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
UninstallDisplayIcon={userappdata}\A&D Voice\selected-theme.ico

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
; Runtime is already compressed once. Inno only copies the archive from ISO.
Source: "{src}\app-runtime.zip"; DestDir: "{tmp}"; Flags: external ignoreversion deleteafterinstall

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
  ThemeCard: TNewStaticText;
  InstallModelsCheck: TNewCheckBox;
  RemoveUserData: Boolean;
  ModelProgressTimerID: Integer;
  ModelProgressPath: String;

function SetTimer(hWnd, nIDEvent, uElapse, lpTimerFunc: Longword): Longword;
external 'SetTimer@user32.dll stdcall';

function KillTimer(hWnd, nIDEvent: Longword): Boolean;
external 'KillTimer@user32.dll stdcall';

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
begin
  ThemeCard.Caption := 'A&D Voice  ·  ' + ThemeCombo.Text;
  case ThemeCombo.ItemIndex of
    1:
      begin
        ThemeCard.Color := $00F4F1EF;
        ThemeCard.Font.Color := $0031211B;
      end;
    2:
      begin
        ThemeCard.Color := $00234317;
        ThemeCard.Font.Color := $00E9FFE1;
      end;
    3:
      begin
        ThemeCard.Color := $00421F35;
        ThemeCard.Font.Color := $00F8E8FF;
      end;
  else
    begin
      ThemeCard.Color := $00170D14;
      ThemeCard.Font.Color := $00F4EAF1;
    end;
  end;
end;

procedure InitializeWizard;
var
  LanguageLabel: TNewStaticText;
  ThemeLabel: TNewStaticText;
  ModelsHint: TNewStaticText;
begin
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
  ThemeLabel.Caption := 'Тема оформления';
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

  ThemeCard := TNewStaticText.Create(PreferencesPage);
  ThemeCard.Parent := PreferencesPage.Surface;
  ThemeCard.AutoSize := False;
  ThemeCard.Font.Style := [fsBold];
  ThemeCard.SetBounds(ScaleX(290), ScaleY(104), ScaleX(170), ScaleY(30));
  ThemeChanged(nil);

  InstallModelsCheck := TNewCheckBox.Create(PreferencesPage);
  InstallModelsCheck.Parent := PreferencesPage.Surface;
  InstallModelsCheck.Caption := 'Загрузить AI-модели во время установки';
  InstallModelsCheck.Checked := True;
  InstallModelsCheck.SetBounds(0, ScaleY(158), ScaleX(420), ScaleY(24));

  ModelsHint := TNewStaticText.Create(PreferencesPage);
  ModelsHint.Parent := PreferencesPage.Surface;
  ModelsHint.AutoSize := False;
  ModelsHint.WordWrap := True;
  ModelsHint.Font.Color := clGray;
  ModelsHint.Caption :=
    'Для загрузки нужен интернет, потребуется несколько гигабайт. ' +
    'Если отключить этот пункт, программа установится без моделей — ' +
    'их можно будет скачать позже в настройках A&D Voice.';
  ModelsHint.SetBounds(ScaleX(20), ScaleY(184), ScaleX(440), ScaleY(52));
end;

function SelectedTheme: String;
begin
  if ThemeCombo = nil then
  begin
    Result := 'dark';
    Exit;
  end;
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
  AppDataDir: String;
  SettingsDir: String;
  SettingsPath: String;
  InstallPreferencesPath: String;
  ThemePath: String;
  ThemeIconPath: String;
  Payload: String;
begin
  AppDataDir := ExpandConstant('{userappdata}\A&D Voice');
  SettingsDir := ExpandConstant('{localappdata}\A&D Voice\backend-data');
  SettingsPath := SettingsDir + '\settings.json';
  ForceDirectories(SettingsDir);
  Payload := '{' + #13#10 +
    '  "language": "' + SelectedLanguage + '",' + #13#10 +
    '  "theme": "' + SelectedTheme + '",' + #13#10 +
    '  "compute_mode": "auto"' + #13#10 +
    '}' + #13#10;
  if (not FileExists(SettingsPath)) and
     (not SaveStringToFile(SettingsPath, Payload, False)) then
    RaiseException('Не удалось сохранить начальные настройки программы.');

  InstallPreferencesPath := ExpandConstant('{localappdata}\A&D Voice\install-preferences.json');
  Payload := '{' + #13#10 +
    '  "language": "' + SelectedLanguage + '",' + #13#10 +
    '  "theme": "' + SelectedTheme + '"' + #13#10 +
    '}' + #13#10;
  if not SaveStringToFile(InstallPreferencesPath, Payload, False) then
    RaiseException('Не удалось передать выбранную тему программе.');

  ThemePath := AppDataDir + '\selected-theme.txt';
  if not SaveStringToFile(ThemePath, SelectedTheme, False) then
    RaiseException('Не удалось сохранить иконку выбранной темы.');
  ThemeIconPath := AppDataDir + '\selected-theme.ico';
  if not FileCopy(SelectedIconPath(''), ThemeIconPath, False) then
    RaiseException('Не удалось подготовить системную иконку выбранной темы.');
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

function ProgressValue(const Key: String): String;
var
  Lines: TArrayOfString;
  I: Integer;
  Prefix: String;
begin
  Result := '';
  if (ModelProgressPath = '') or
     (not LoadStringsFromFile(ModelProgressPath, Lines)) then
    Exit;
  Prefix := Key + '=';
  for I := 0 to GetArrayLength(Lines) - 1 do
    if Pos(Prefix, Lines[I]) = 1 then
    begin
      Result := Copy(Lines[I], Length(Prefix) + 1, MaxInt);
      Exit;
    end;
end;

function ApproximateTime(RemainingSeconds: Integer): String;
var
  Minutes: Integer;
begin
  Minutes := (RemainingSeconds + 59) div 60;
  if Minutes < 1 then
    Result := 'меньше минуты'
  else if Minutes < 60 then
    Result := IntToStr(Minutes) + ' мин'
  else
    Result := IntToStr(Minutes div 60) + ' ч ' + IntToStr(Minutes mod 60) + ' мин';
end;

function FormatGigabytes(Megabytes: Integer): String;
begin
  Result := IntToStr(Megabytes div 1024) + '.' +
    IntToStr(((Megabytes mod 1024) * 10) div 1024);
end;

procedure UpdateModelProgress(Sender: TObject);
var
  DownloadedMB: Integer;
  TotalMB: Integer;
  RemainingSeconds: Integer;
  ActiveModel: String;
  Status: String;
begin
  DownloadedMB := StrToIntDef(ProgressValue('downloaded_mb'), 0);
  TotalMB := StrToIntDef(ProgressValue('total_mb'), 0);
  if TotalMB <= 0 then
    Exit;

  WizardForm.ProgressGauge.Style := npbstNormal;
  WizardForm.ProgressGauge.Max := 1000;
  WizardForm.ProgressGauge.Position := DownloadedMB * 1000 div TotalMB;
  Status := 'Этап 3 из 3: загружено ' +
    FormatGigabytes(DownloadedMB) + ' из ' +
    FormatGigabytes(TotalMB) + ' ГБ';

  RemainingSeconds := StrToIntDef(ProgressValue('remaining_seconds'), -1);
  if RemainingSeconds >= 0 then
    Status := Status + ' · осталось примерно ' + ApproximateTime(RemainingSeconds);
  ActiveModel := ProgressValue('active');
  if ActiveModel <> '' then
    Status := Status + ' · ' + ActiveModel;
  WizardForm.StatusLabel.Caption := Status;
end;

procedure ModelProgressTimerProc(Arg1, Arg2, Arg3, Arg4: Longword);
begin
  UpdateModelProgress(nil);
end;

procedure StopModelProgressTimer;
begin
  if ModelProgressTimerID <> 0 then
  begin
    KillTimer(0, ModelProgressTimerID);
    ModelProgressTimerID := 0;
  end;
end;

procedure DeinitializeSetup;
begin
  StopModelProgressTimer;
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

    if InstallModelsCheck.Checked then
      ShowPendingInstallStep(
        'Этап 2 из 3: распаковка программы. Установка ещё не завершена...'
      )
    else
      ShowPendingInstallStep(
        'Этап 2 из 2: распаковка программы. Установка ещё не завершена...'
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

    if not InstallModelsCheck.Checked then
    begin
      CompleteInstallProgress;
      WizardForm.StatusLabel.Caption :=
        'Установка A&D Voice завершена. AI-модели можно скачать позже в настройках.';
      Exit;
    end;

    BackendExe := ExpandConstant('{app}\resources\backend\KaraokeBackend.exe');
    // Store downloads outside the application directory so an Inno rollback
    // does not erase completed multi-gigabyte files after a network failure.
    ModelsDir := ExpandConstant('{localappdata}\A&D Voice\models');
    ModelCacheDir := ExpandConstant('{localappdata}\A&D Voice\model-cache');
    ModelLogPath := ExpandConstant('{localappdata}\A&D Voice\logs\model-install.log');
    ModelProgressPath := ExpandConstant('{localappdata}\A&D Voice\logs\model-progress.txt');
    DeleteFile(ModelProgressPath);
    ForceDirectories(ModelsDir);
    ShowPendingInstallStep(
      'Этап 3 из 3: подготовка загрузки AI-моделей...'
    );
    ModelProgressTimerID := SetTimer(0, 0, 1000, CreateCallback(@ModelProgressTimerProc));
    if not Exec(
      BackendExe,
      '--install-ai-models --models-root "' + ModelsDir +
        '" --cache-dir "' + ModelCacheDir + '" --workers 2 --retries 3' +
        ' --log-file "' + ModelLogPath + '"' +
        ' --progress-file "' + ModelProgressPath + '"',
      ExpandConstant('{app}\resources\backend'),
      SW_HIDE,
      ewWaitUntilTerminated,
      ResultCode
    ) then
    begin
      StopModelProgressTimer;
      RaiseException('Не удалось запустить загрузку AI-моделей.');
    end;
    StopModelProgressTimer;
    UpdateModelProgress(nil);
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
