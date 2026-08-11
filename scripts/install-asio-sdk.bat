@echo off
setlocal EnableExtensions

title A^&D Voice - ASIO SDK

rem ============================================================================
rem CONFIG
rem ============================================================================

if "%~1"=="" (
    for %%I in ("%~dp0..") do set "ROOT=%%~fI"
) else (
    for %%I in ("%~1") do set "ROOT=%%~fI"
)

set "DL=%ROOT%\downloads"
set "ENGINES=%DL%\engines"

set "ASIO=%ENGINES%\asio-sdk"
set "TMP=%TEMP%\advoice-asio-sdk"

rem ============================================================================
rem ASIO SDK SOURCE
rem ============================================================================
rem
rem IMPORTANT:
rem Steinberg's ASIO SDK is distributed under its own license.
rem Keep the URL here as the single source used by the project.
rem
rem Put the official/direct SDK ZIP URL below if your project already has one.
rem Alternatively, place asio-sdk.zip into:
rem
rem   downloads\asio-sdk.zip
rem
rem and this script will install it without downloading anything.
rem ============================================================================

set "LOCAL_ZIP=%DL%\asio-sdk.zip"
set "ZIP=%TMP%\asio-sdk.zip"

rem Optional direct download URL.
rem Leave empty if you provide downloads\asio-sdk.zip yourself.

set "ASIO_URL="

rem ============================================================================
rem HEADER
rem ============================================================================

echo.
echo ============================================================
echo  A^&D Voice - ASIO SDK
echo ============================================================
echo.

echo Project:
echo   %ROOT%

echo.
echo ASIO SDK:
echo   %ASIO%
echo.

rem ============================================================================
rem FAST CHECK
rem ============================================================================

call :verify >nul 2>&1

if not errorlevel 1 (
    echo ASIO SDK is ready.
    exit /b 0
)

echo ASIO SDK is missing or incomplete.
echo.

rem ============================================================================
rem DIRECTORIES
rem ============================================================================

if not exist "%DL%\" (
    mkdir "%DL%" >nul 2>&1 || goto :fail
)

if not exist "%ENGINES%\" (
    mkdir "%ENGINES%" >nul 2>&1 || goto :fail
)

if exist "%TMP%\" (
    rmdir /s /q "%TMP%" >nul 2>&1
)

mkdir "%TMP%" >nul 2>&1 || goto :fail

rem ============================================================================
rem GET ARCHIVE
rem ============================================================================

if exist "%LOCAL_ZIP%" (

    echo Using local ASIO SDK archive:
    echo   %LOCAL_ZIP%
    echo.

    copy /y "%LOCAL_ZIP%" "%ZIP%" >nul || goto :fail

    goto :extract
)

if not defined ASIO_URL (
    echo [ERROR] ASIO SDK archive was not found.
    echo.
    echo Expected local archive:
    echo   %LOCAL_ZIP%
    echo.
    echo Either:
    echo   1. Put the ASIO SDK ZIP at the path above.
    echo   2. Configure ASIO_URL in:
    echo      %~f0
    echo.
    goto :fail
)

echo Downloading ASIO SDK...
echo.

where curl.exe >nul 2>&1

if not errorlevel 1 (

    curl.exe ^
        -L ^
        --fail ^
        --retry 5 ^
        --retry-delay 2 ^
        --progress-bar ^
        -o "%ZIP%" ^
        "%ASIO_URL%"

    if not errorlevel 1 goto :download_ok
)

echo curl failed. Trying PowerShell...

powershell.exe ^
    -NoProfile ^
    -ExecutionPolicy Bypass ^
    -Command ^
    "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '%ASIO_URL%' -OutFile '%ZIP%'"

if errorlevel 1 goto :fail

:download_ok

if not exist "%ZIP%" (
    echo [ERROR] ASIO SDK download failed.
    goto :fail
)

for %%F in ("%ZIP%") do (
    if %%~zF==0 (
        echo [ERROR] Downloaded ASIO SDK archive is empty.
        goto :fail
    )
)

rem ============================================================================
rem EXTRACT
rem ============================================================================

:extract

echo Extracting ASIO SDK...
echo.

set "UNPACK=%TMP%\unpack"

if exist "%UNPACK%\" (
    rmdir /s /q "%UNPACK%" >nul 2>&1
)

mkdir "%UNPACK%" >nul 2>&1 || goto :fail

powershell.exe ^
    -NoProfile ^
    -ExecutionPolicy Bypass ^
    -Command ^
    "Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%UNPACK%' -Force"

if errorlevel 1 (
    echo [ERROR] Failed to extract ASIO SDK.
    goto :fail
)

rem ============================================================================
rem FIND SDK ROOT
rem ============================================================================

echo Locating ASIO SDK...

set "FOUND="

for /f "usebackq delims=" %%D in (`
    powershell.exe ^
        -NoProfile ^
        -ExecutionPolicy Bypass ^
        -Command ^
        "$root='%UNPACK%';" ^
        "$f=Get-ChildItem -LiteralPath $root -Recurse -File -Filter asio.h -ErrorAction SilentlyContinue ^|" ^
        "Select-Object -First 1;" ^
        "if($f){$f.Directory.FullName}"
`) do (
    set "FOUND=%%D"
)

if not defined FOUND (
    echo.
    echo [ERROR] asio.h was not found inside the ASIO SDK archive.
    goto :fail
)

rem ============================================================================
rem NORMALIZE SDK LAYOUT
rem ============================================================================

if exist "%ASIO%\" (
    rmdir /s /q "%ASIO%" >nul 2>&1
)

mkdir "%ASIO%" >nul 2>&1 || goto :fail

echo.
echo Installing ASIO SDK...

powershell.exe ^
    -NoProfile ^
    -ExecutionPolicy Bypass ^
    -Command ^
    "$src='%FOUND%';" ^
    "$dst='%ASIO%';" ^
    "$root=Split-Path -Parent $src;" ^
    "if(Test-Path -LiteralPath (Join-Path $root 'common')){" ^
    "Copy-Item -LiteralPath (Join-Path $root '*') -Destination $dst -Recurse -Force -ErrorAction SilentlyContinue" ^
    "}else{" ^
    "Copy-Item -LiteralPath (Join-Path $src '*') -Destination $dst -Recurse -Force" ^
    "}"

rem The wildcard + LiteralPath combination above is not reliable on all
rem PowerShell versions. If asio.h was not copied, copy the detected tree
rem using robocopy as a fallback.

call :verify >nul 2>&1

if errorlevel 1 (

    rmdir /s /q "%ASIO%" >nul 2>&1
    mkdir "%ASIO%" >nul 2>&1 || goto :fail

    for %%D in ("%FOUND%") do set "FOUND_PARENT=%%~dpD"

    robocopy ^
        "%FOUND%" ^
        "%ASIO%" ^
        /E ^
        /R:2 ^
        /W:1 ^
        /NFL ^
        /NDL ^
        /NJH ^
        /NJS >nul

    if errorlevel 8 goto :fail
)

rem ============================================================================
rem VERIFY
rem ============================================================================

call :verify

if errorlevel 1 goto :fail

rem ============================================================================
rem CLEANUP
rem ============================================================================

if exist "%TMP%\" (
    rmdir /s /q "%TMP%" >nul 2>&1
)

echo.
echo ============================================================
echo  ASIO SDK READY
echo ============================================================
echo.

echo Location:
echo   %ASIO%
echo.

exit /b 0

rem ============================================================================
rem VERIFY SDK
rem ============================================================================

:verify

if not exist "%ASIO%\" exit /b 1

rem Do not hardcode one exact ASIO SDK archive layout.
rem The build only needs a valid SDK tree containing the core headers.

where /q where.exe >nul 2>&1

set "ASIO_HEADER="

for /f "usebackq delims=" %%F in (`
    powershell.exe ^
        -NoProfile ^
        -ExecutionPolicy Bypass ^
        -Command ^
        "$f=Get-ChildItem -LiteralPath '%ASIO%' -Recurse -File -Filter asio.h -ErrorAction SilentlyContinue ^| Select-Object -First 1; if($f){$f.FullName}"
`) do (
    set "ASIO_HEADER=%%F"
)

if not defined ASIO_HEADER exit /b 1

set "ASIO_DRIVERS_HEADER="

for /f "usebackq delims=" %%F in (`
    powershell.exe ^
        -NoProfile ^
        -ExecutionPolicy Bypass ^
        -Command ^
        "$f=Get-ChildItem -LiteralPath '%ASIO%' -Recurse -File -Filter asiodrivers.h -ErrorAction SilentlyContinue ^| Select-Object -First 1; if($f){$f.FullName}"
`) do (
    set "ASIO_DRIVERS_HEADER=%%F"
)

if not defined ASIO_DRIVERS_HEADER exit /b 1

echo [OK] asio.h
echo [OK] asiodrivers.h

exit /b 0

rem ============================================================================
rem FAIL
rem ============================================================================

:fail

echo.
echo ============================================================
echo  ASIO SDK INSTALLATION FAILED
echo ============================================================
echo.

echo Check the error above.
echo.

rem No PAUSE here:
rem this installer can run as a background start-dev job.

exit /b 1