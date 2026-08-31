@echo off
setlocal EnableExtensions EnableDelayedExpansion
title A^&D Voice - ASIO SDK

if "%~1"=="" (for %%I in ("%~dp0..") do set "ROOT=%%~fI") else for %%I in ("%~1") do set "ROOT=%%~fI"

set "ASIO=%ROOT%\downloads\engines\asio-sdk"
set "TMP=%TEMP%\advoice-asio"
set "ZIP=%TMP%\asio.zip"
set "UNPACK=%TMP%\unpack"
set "ZIPURL=https://www.steinberg.net/asiosdk"
set "ZIP_SHA256=D5EBF0C20DD2C5F43771FD0C1418F4B361BF52434EE670097CFA6B3A335E2ECA"

call :verify >nul 2>&1 && (
    echo ASIO SDK is ready.
    exit /b 0
)

echo ASIO SDK is missing or incomplete.
rmdir /s /q "%ASIO%" "%TMP%" >nul 2>&1
mkdir "%ROOT%\downloads\engines" >nul 2>&1
mkdir "%TMP%" >nul 2>&1 || goto :fail

mkdir "%UNPACK%" >nul 2>&1 || goto :fail
echo Downloading official Steinberg ASIO SDK...

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
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
"$s=[IO.File]::OpenRead('%ZIP%');try{$h=[Security.Cryptography.SHA256]::Create();$v=([BitConverter]::ToString($h.ComputeHash($s))).Replace('-','')}finally{$s.Dispose()};if($v -ne '%ZIP_SHA256%'){exit 1}"
if errorlevel 1 (
    echo [ERROR] ASIO SDK archive checksum mismatch.
    goto :fail
)

echo Extracting ASIO SDK...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
"Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%UNPACK%' -Force"
if errorlevel 1 goto :fail

set "SRC="
for /d %%D in ("%UNPACK%\*") do (
    if exist "%%~fD\common\asio.cpp" if exist "%%~fD\host\asiodrivers.cpp" if exist "%%~fD\host\pc\asiolist.cpp" set "SRC=%%~fD"
)
if not defined SRC goto :fail

robocopy "!SRC!" "%ASIO%" /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto :fail

call :verify || goto :fail

:ok
rmdir /s /q "%TMP%" >nul 2>&1
echo ASIO SDK is ready.
exit /b 0

:verify
for %%F in (
    "%ASIO%\common\asio.h"
    "%ASIO%\common\asio.cpp"
    "%ASIO%\host\asiodrivers.h"
    "%ASIO%\host\asiodrivers.cpp"
    "%ASIO%\host\pc\asiolist.cpp"
    "%ASIO%\LICENSE.txt"
) do if not exist "%%~F" exit /b 1
exit /b 0

:fail
echo [ERROR] ASIO SDK installation failed.
rmdir /s /q "%TMP%" >nul 2>&1
exit /b 1
