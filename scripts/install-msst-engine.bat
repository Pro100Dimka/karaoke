@echo off
setlocal EnableExtensions EnableDelayedExpansion
title A^&D Voice - MSST Engine

if "%~1"=="" (for %%I in ("%~dp0..") do set "ROOT=%%~fI") else for %%I in ("%~1") do set "ROOT=%%~fI"

set "DL=%ROOT%\downloads"
set "ENGINE=%DL%\engines\msst"
set "TMP=%TEMP%\advoice-msst-%RANDOM%-%RANDOM%"
set "ZIP=%TMP%\msst.zip"
set "UNPACK=%TMP%\unpack"
set "REPO=https://github.com/ZFTurbo/Music-Source-Separation-Training.git"
set "ZIPURL=https://github.com/ZFTurbo/Music-Source-Separation-Training/archive/refs/heads/main.zip"

call :verify >nul 2>&1 && (
    echo MSST engine is ready.
    exit /b 0
)

echo MSST engine is missing or incomplete.
echo Restoring it into:
echo   %ENGINE%
echo.

rmdir /s /q "%TMP%" >nul 2>&1
mkdir "%DL%\engines" >nul 2>&1 || goto :fail
mkdir "%TMP%" >nul 2>&1 || goto :fail

where git.exe >nul 2>&1
if not errorlevel 1 (
    echo Downloading MSST engine with Git...
    rmdir /s /q "%ENGINE%" >nul 2>&1
    git clone --quiet --depth 1 "%REPO%" "%ENGINE%" >nul 2>&1
    if not errorlevel 1 (
        call :verify >nul 2>&1
        if not errorlevel 1 goto :ok
    )
    echo Git download was incomplete. Trying ZIP fallback...
    rmdir /s /q "%ENGINE%" >nul 2>&1
)

mkdir "%UNPACK%" >nul 2>&1 || goto :fail
echo Downloading MSST engine ZIP...

where curl.exe >nul 2>&1
if not errorlevel 1 curl.exe -LfsS --retry 5 --retry-delay 2 -o "%ZIP%" "%ZIPURL%"

if not exist "%ZIP%" (
    echo curl failed. Trying PowerShell...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='SilentlyContinue';Invoke-WebRequest -UseBasicParsing -Uri '%ZIPURL%' -OutFile '%ZIP%'"
    if errorlevel 1 goto :fail
)

if not exist "%ZIP%" goto :fail
for %%F in ("%ZIP%") do if %%~zF==0 goto :fail

echo Extracting MSST engine...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
"Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%UNPACK%' -Force"
if errorlevel 1 goto :fail

set "SRC="
for /d %%D in ("%UNPACK%\*") do (
    if exist "%%~fD\inference.py" if exist "%%~fD\configs\KimberleyJensen\config_vocals_mel_band_roformer_kj.yaml" set "SRC=%%~fD"
)
if not defined SRC goto :fail

rmdir /s /q "%ENGINE%" >nul 2>&1
mkdir "%ENGINE%" >nul 2>&1 || goto :fail
robocopy "!SRC!" "%ENGINE%" /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :fail

call :verify || goto :fail

:ok
rem Never package Git metadata from the disposable downloads cache.
rmdir /s /q "%ENGINE%\.git" >nul 2>&1
rmdir /s /q "%TMP%" >nul 2>&1
echo MSST engine is ready.
exit /b 0

:verify
for %%F in (
    "%ENGINE%\inference.py"
    "%ENGINE%\utils\model_utils.py"
    "%ENGINE%\models\bs_roformer\mel_band_roformer.py"
    "%ENGINE%\configs\KimberleyJensen\config_vocals_mel_band_roformer_kj.yaml"
) do if not exist "%%~F" exit /b 1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0patch-msst-engine.ps1" -Engine "%ENGINE%" >nul 2>&1
if errorlevel 1 exit /b 1
exit /b 0

:fail
echo.
echo [ERROR] MSST engine restoration failed.
echo        downloads\ is intentionally ignored by Git, so this engine must be recoverable automatically.
rmdir /s /q "%TMP%" >nul 2>&1
exit /b 1
