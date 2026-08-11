@echo off
setlocal EnableExtensions EnableDelayedExpansion
title A^&D Voice - ASIO SDK

if "%~1"=="" (for %%I in ("%~dp0..") do set "ROOT=%%~fI") else for %%I in ("%~1") do set "ROOT=%%~fI"

set "ASIO=%ROOT%\downloads\engines\asio-sdk"
set "TMP=%TEMP%\advoice-asio"
set "ZIP=%TMP%\asio.zip"
set "UNPACK=%TMP%\unpack"
set "REPO=https://github.com/audiosdk/asio.git"
set "ZIPURL=https://github.com/audiosdk/asio/archive/refs/heads/main.zip"

echo.
echo ============================================================
echo  A^&D Voice - ASIO SDK
echo ============================================================
echo.

call :verify >nul 2>&1 && (
    echo ASIO SDK is ready.
    exit /b 0
)

echo ASIO SDK is missing or incomplete.
echo.

mkdir "%ROOT%\downloads\engines" >nul 2>&1
rmdir /s /q "%ASIO%" "%TMP%" >nul 2>&1
mkdir "%TMP%" >nul 2>&1 || goto :fail

rem ============================================================================
rem GIT
rem ============================================================================

where git.exe >nul 2>&1
if not errorlevel 1 (
    echo Downloading ASIO SDK with Git...

    git clone --quiet --depth 1 "%REPO%" "%ASIO%" >nul 2>&1

    if not errorlevel 1 (
        call :verify
        if not errorlevel 1 goto :ok
    )

    echo Git download failed. Trying ZIP...
    rmdir /s /q "%ASIO%" >nul 2>&1
) else (
    echo Git not found. Using ZIP...
)

rem ============================================================================
rem ZIP FALLBACK
rem ============================================================================

mkdir "%UNPACK%" >nul 2>&1 || goto :fail

echo Downloading ASIO SDK ZIP...

where curl.exe >nul 2>&1
if not errorlevel 1 (
    curl.exe -LfsS --retry 5 --retry-delay 2 -o "%ZIP%" "%ZIPURL%"
)

if not exist "%ZIP%" (
    echo curl failed. Trying PowerShell...

    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='SilentlyContinue';Invoke-WebRequest -Uri '%ZIPURL%' -OutFile '%ZIP%'"

    if errorlevel 1 goto :fail
)

if not exist "%ZIP%" goto :fail