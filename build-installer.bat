@echo off
setlocal EnableExtensions EnableDelayedExpansion

title A^&D Voice - Complete Offline Installer Builder

rem ============================================================
rem BUILD MODES
rem ============================================================
rem
rem   build-installer.bat
rem       Normal full build.
rem       Rebuilds backend, ASIO, frontend, Electron and installer.
rem       Existing AI models are preserved and reused.
rem       Only changed/new model folders/files are synchronized.
rem
rem   build-installer.bat fast
rem       Reuses build\backend\dist\KaraokeBackend.
rem       Checks/synchronizes models.
rem       Rebuilds React, Electron and installer.
rem
rem   build-installer.bat installer
rem       Reuses build\electron\win-unpacked.
rem       Builds only Inno Setup installer and checksums.
rem
rem   build-installer.bat clean
rem       Completely removes build cache/output and rebuilds everything.
rem       AI models will therefore be copied again.
rem ============================================================

set "BUILD_MODE=%~1"
set "INTERNAL_WORKER="

if /I "%BUILD_MODE%"=="__worker_backend" set "INTERNAL_WORKER=1"
if /I "%BUILD_MODE%"=="__worker_asio" set "INTERNAL_WORKER=1"
if /I "%BUILD_MODE%"=="__worker_frontend" set "INTERNAL_WORKER=1"
if /I "%BUILD_MODE%"=="__worker_package_models" set "INTERNAL_WORKER=1"

if not defined BUILD_MODE (
    set "BUILD_MODE=full"
)

if defined INTERNAL_WORKER goto :build_mode_validated

if /I not "%BUILD_MODE%"=="full" (
    if /I not "%BUILD_MODE%"=="fast" (
        if /I not "%BUILD_MODE%"=="installer" (
            if /I not "%BUILD_MODE%"=="clean" (
                echo.
                echo [ERROR] Unknown build mode: %BUILD_MODE%
                echo.
                echo Supported modes:
                echo   full
                echo   fast
                echo   installer
                echo   clean
                echo.
                exit /b 1
            )
        )
    )
)

:build_mode_validated

rem ============================================================
rem CONFIGURATION
rem ============================================================

set "ROOT=%~dp0"

set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%front"

set "BUILD=%ROOT%build"
set "DOWNLOADS=%ROOT%downloads"
set "RELEASE=%ROOT%release"

set "KARAOKE_RELEASE=%RELEASE%"

rem ------------------------------------------------------------
rem Build output
rem ------------------------------------------------------------

set "BACKEND_DIST=%BUILD%\backend\dist\KaraokeBackend"

set "UNPACKED=%BUILD%\electron\win-unpacked"

set "INSTALLER_DIR=%RELEASE%"
set "TEMP_DIR=%BUILD%\installer"

rem ------------------------------------------------------------
rem Preserved reusable resources
rem ------------------------------------------------------------

set "PRESERVED_AI=%BUILD%\preserved-ai"
set "PRESERVED_MODELS=%PRESERVED_AI%\models"
set "PRESERVED_MSST=%PRESERVED_AI%\msst"

set "PARALLEL_DIR=%BUILD%\parallel"

rem ------------------------------------------------------------
rem Python
rem ------------------------------------------------------------

set "PYTHON=%BACKEND%\venv\Scripts\python.exe"

rem ------------------------------------------------------------
rem Electron packaged resources
rem ------------------------------------------------------------

set "PACKAGED_BACKEND=%UNPACKED%\resources\backend"

set "SCENE_VIDEO_SOURCE=%DOWNLOADS%\media\videoplayback.webm"
set "PACKAGED_SCENE_VIDEO=%UNPACKED%\resources\media\videoplayback.webm"

rem ------------------------------------------------------------
rem Native ASIO
rem ------------------------------------------------------------

set "ASIO=%BACKEND%\engines\asio"
set "ASIO_BUILD=%BUILD%\asio"
set "ASIO_SDK=%DOWNLOADS%\engines\asio-sdk"

rem ------------------------------------------------------------
rem Offline models / engines
rem ------------------------------------------------------------

set "MODELS=%DOWNLOADS%\models"
set "MSST_ENGINE=%DOWNLOADS%\engines\msst"

rem ------------------------------------------------------------
rem Visual Studio
rem ------------------------------------------------------------

set "VS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools"

set "VCVARS=%VS%\VC\Auxiliary\Build\vcvars64.bat"

set "CMAKE=%VS%\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"

set "NINJA=%VS%\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe"

rem ------------------------------------------------------------
rem Application
rem ------------------------------------------------------------

set "APP_NAME=A&D Voice"
set "APP_VERSION=1.0.0"
set "APP_EXE=A&D Voice.exe"
set "APP_ID=E734496E-2622-5565-89D3-45451D9DE7EE"

rem ------------------------------------------------------------
rem Scripts
rem ------------------------------------------------------------

set "MODEL_SCRIPT=%ROOT%scripts\ensure-offline-models.bat"
set "INNO_TEMPLATE=%ROOT%scripts\karaoke-studio.iss"
set "SIGN_SCRIPT=%ROOT%scripts\sign-windows.ps1"

set "SETUP_ICON=%FRONTEND%\assets\icons\app.ico"

rem ------------------------------------------------------------
rem Installer
rem ------------------------------------------------------------

set "INSTALLER_EXE=%INSTALLER_DIR%\A&D Voice Setup %APP_VERSION%.exe"

set "CHECKSUM_FILE=%INSTALLER_DIR%\SHA256SUMS.txt"

set "KARAOKE_INSTALLER_DIR=%INSTALLER_DIR%"
set "KARAOKE_CHECKSUM_FILE=%CHECKSUM_FILE%"

rem ------------------------------------------------------------
rem PyInstaller
rem ------------------------------------------------------------

set "PYINSTALLER_CLEAN="

if /I "%BUILD_MODE%"=="clean" (
    set "PYINSTALLER_CLEAN=--clean"
)

rem Internal workers inherit the parent environment. The second argument
rem contains the real parent build mode so clean builds keep --clean.
if defined INTERNAL_WORKER (
    if /I "%~2"=="clean" set "PYINSTALLER_CLEAN=--clean"

    if /I "%BUILD_MODE%"=="__worker_backend" goto :parallel_worker_backend
    if /I "%BUILD_MODE%"=="__worker_asio" goto :parallel_worker_asio
    if /I "%BUILD_MODE%"=="__worker_frontend" goto :parallel_worker_frontend
    if /I "%BUILD_MODE%"=="__worker_package_models" goto :parallel_worker_package_models
)

rem ============================================================
rem START
rem ============================================================

echo.
echo ============================================================
echo  A^&D VOICE - COMPLETE OFFLINE INSTALLER
echo ============================================================
echo.
echo Build mode:
echo   %BUILD_MODE%
echo.
echo Project:
echo   %ROOT%
echo.
echo Build intermediates:
echo   %BUILD%
echo.
echo Downloaded resources:
echo   %DOWNLOADS%
echo.
echo Final release:
echo   %RELEASE%
echo.

call :stop_build_processes
if errorlevel 1 goto :failed

call :environment
if errorlevel 1 goto :failed

call :prepare_output
if errorlevel 1 goto :failed

rem ============================================================
rem INSTALLER ONLY
rem ============================================================

if /I "%BUILD_MODE%"=="installer" (
    goto :installer_only
)

rem ============================================================
rem FAST
rem ============================================================

if /I "%BUILD_MODE%"=="fast" (
    goto :fast_build
)

rem ============================================================
rem FULL / CLEAN
rem ============================================================

call :models
if errorlevel 1 goto :failed

rem Backend PyInstaller, native ASIO compilation and React compilation
rem are independent and can safely run at the same time.
call :parallel_full_build
if errorlevel 1 goto :failed

rem ASIO may only be copied/signed after backend PyInstaller has finished.
call :asio_finalize
if errorlevel 1 goto :failed

call :package_models
if errorlevel 1 goto :failed

goto :build_electron_package

rem ============================================================
rem FAST BUILD
rem ============================================================

:fast_build

echo.
echo ============================================================
echo  FAST BUILD
echo ============================================================
echo.
echo Reusing existing packaged backend:
echo   %BACKEND_DIST%
echo.
echo Checking AI resources for changes...
echo.

call :verify_backend_base
if errorlevel 1 (
    echo.
    echo [ERROR] Fast build cannot continue because the packaged
    echo backend is missing or incomplete.
    echo.
    echo Run:
    echo   build-installer.bat
    echo.
    goto :failed
)

rem Model synchronization and React compilation are independent.
call :parallel_fast_build
if errorlevel 1 goto :failed

goto :build_electron_package

rem ============================================================
rem ELECTRON
rem ============================================================

:build_electron

call :electron
if errorlevel 1 goto :failed

goto :build_installer

:build_electron_package

call :electron_package
if errorlevel 1 goto :failed

goto :build_installer

rem ============================================================
rem INSTALLER ONLY
rem ============================================================

:installer_only

echo.
echo ============================================================
echo  INSTALLER ONLY
echo ============================================================
echo.
echo Reusing:
echo   %UNPACKED%
echo.

call :verify_unpacked

if errorlevel 1 (
    echo.
    echo [ERROR] Installer-only mode cannot continue because
    echo win-unpacked is missing or incomplete.
    echo.
    echo Run one of these commands first:
    echo.
    echo   build-installer.bat
    echo   build-installer.bat fast
    echo.
    goto :failed
)

rem ============================================================
rem BUILD INSTALLER
rem ============================================================

:build_installer

call :installer
if errorlevel 1 goto :failed

call :checksums
if errorlevel 1 goto :failed

call :remove_directory "%TEMP_DIR%"
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo  BUILD COMPLETED SUCCESSFULLY
echo ============================================================
echo.
echo Complete offline installer:
echo   %INSTALLER_DIR%
echo.
echo Main installer:
echo   %INSTALLER_EXE%
echo.
echo IMPORTANT:
echo   Keep Setup.exe and every Setup-*.bin file together.
echo.
echo SHA-256 checksums:
echo   %CHECKSUM_FILE%
echo.

start "" explorer.exe "%INSTALLER_DIR%"

exit /b 0


rem ============================================================
rem STOP BUILD / APP PROCESSES
rem ============================================================

:stop_build_processes

echo.
echo [0/6] Closing old A^&D Voice build processes...

rem Do NOT kill generic electron.exe/node.exe/ffmpeg.exe globally.
rem They may belong to unrelated applications.

taskkill /F /T /IM "%APP_EXE%" >nul 2>&1
taskkill /F /T /IM KaraokeBackend.exe >nul 2>&1
taskkill /F /T /IM KaraokeAudioMonitor.exe >nul 2>&1
taskkill /F /T /IM KaraokeAsioBridge.exe >nul 2>&1

rem ------------------------------------------------------------
rem Close programs physically running from release folder
rem ------------------------------------------------------------

if exist "%RELEASE%\" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "$release=[IO.Path]::GetFullPath($env:KARAOKE_RELEASE);" ^
        "Get-Process -ErrorAction SilentlyContinue | ForEach-Object {" ^
        "  try {" ^
        "    $path=$_.Path;" ^
        "    if($path) {" ^
        "      $full=[IO.Path]::GetFullPath($path);" ^
        "      if($full.StartsWith($release,[StringComparison]::OrdinalIgnoreCase)) {" ^
        "        Write-Host ('  Closing PID ' + $_.Id + ': ' + $_.ProcessName);" ^
        "        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue;" ^
        "      }" ^
        "    }" ^
        "  } catch {}" ^
        "}"
)

rem ------------------------------------------------------------
rem Close helper processes referencing release in command line
rem ------------------------------------------------------------

if exist "%RELEASE%\" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "$release=[IO.Path]::GetFullPath($env:KARAOKE_RELEASE);" ^
        "$self=$PID;" ^
        "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {" ^
        "  if($_.ProcessId -ne $self -and $_.CommandLine) {" ^
        "    if($_.CommandLine.IndexOf($release,[StringComparison]::OrdinalIgnoreCase) -ge 0) {" ^
        "      try {" ^
        "        Write-Host ('  Closing PID ' + $_.ProcessId + ': ' + $_.Name);" ^
        "        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue;" ^
        "      } catch {}" ^
        "    }" ^
        "  }" ^
        "}"
)

rem Windows can keep DLL/app.asar handles briefly after process exit.

timeout /t 2 /nobreak >nul

exit /b 0


rem ============================================================
rem PREPARE OUTPUT
rem ============================================================

:prepare_output

echo.
echo [0/6] Preparing build output...

rem ============================================================
rem INSTALLER MODE
rem ============================================================

if /I "%BUILD_MODE%"=="installer" (

    call :remove_directory "%INSTALLER_DIR%"
    if errorlevel 1 exit /b 1

    call :remove_directory "%TEMP_DIR%"
    if errorlevel 1 exit /b 1

    exit /b 0
)

rem ============================================================
rem FAST MODE
rem ============================================================

if /I "%BUILD_MODE%"=="fast" (

    rem Backend remains untouched.

    call :remove_directory "%UNPACKED%"
    if errorlevel 1 exit /b 1

    call :remove_directory "%INSTALLER_DIR%"
    if errorlevel 1 exit /b 1

    call :remove_directory "%TEMP_DIR%"
    if errorlevel 1 exit /b 1

    exit /b 0
)

rem ============================================================
rem CLEAN MODE
rem ============================================================

if /I "%BUILD_MODE%"=="clean" (

    echo.
    echo Performing complete clean build...
    echo.

    call :remove_directory "%RELEASE%"
    if errorlevel 1 exit /b 1

    call :remove_directory "%BUILD%"
    if errorlevel 1 exit /b 1

    call :remove_directory "%LOCALAPPDATA%\pyinstaller"
    if errorlevel 1 exit /b 1

    exit /b 0
)

rem ============================================================
rem FULL MODE
rem ============================================================
rem
rem CRITICAL:
rem Preserve large AI resources BEFORE deleting backend dist.
rem They will be restored after PyInstaller.
rem
rem This prevents multi-GB model weights from being copied again
rem on every normal build.
rem ============================================================

call :preserve_packaged_ai
if errorlevel 1 exit /b 1

call :remove_directory "%RELEASE%"
if errorlevel 1 exit /b 1

call :remove_directory "%BUILD%\backend\dist"
if errorlevel 1 exit /b 1

call :remove_directory "%UNPACKED%"
if errorlevel 1 exit /b 1

call :remove_directory "%TEMP_DIR%"
if errorlevel 1 exit /b 1

exit /b 0


rem ============================================================
rem ENVIRONMENT
rem ============================================================

:environment

echo.
echo [0/6] Checking build environment...

call :require_directory "%BACKEND%" "Backend directory"
if errorlevel 1 exit /b 1

call :require_directory "%FRONTEND%" "Frontend directory"
if errorlevel 1 exit /b 1

call :require_file "%INNO_TEMPLATE%" "Inno Setup template"
if errorlevel 1 exit /b 1

rem Installer mode does not need compiler/backend tools.

if /I "%BUILD_MODE%"=="installer" (
    exit /b 0
)

call :require_file "%PYTHON%" "Backend virtual environment Python"
if errorlevel 1 exit /b 1

where node.exe >nul 2>&1

if errorlevel 1 (
    echo.
    echo [ERROR] Node.js was not found in PATH.
    exit /b 1
)

where npm.cmd >nul 2>&1

if errorlevel 1 (
    echo.
    echo [ERROR] npm was not found in PATH.
    exit /b 1
)

rem Fast mode does not rebuild native/backend executables.

if /I "%BUILD_MODE%"=="fast" (
    exit /b 0
)

call :require_file "%VCVARS%" "Visual C++ Build Tools"
if errorlevel 1 exit /b 1

call :require_file "%CMAKE%" "Visual Studio CMake"
if errorlevel 1 exit /b 1

call :require_file "%NINJA%" "Visual Studio Ninja"
if errorlevel 1 exit /b 1

call :require_directory "%ASIO%" "ASIO source directory"
if errorlevel 1 exit /b 1

call :require_directory "%ASIO_SDK%" "ASIO SDK directory"
if errorlevel 1 exit /b 1

call :require_file "%MODEL_SCRIPT%" "Offline model verification script"
if errorlevel 1 exit /b 1

set "FFMPEG="

for %%F in (ffmpeg.exe) do (
    set "FFMPEG=%%~$PATH:F"
)

if not defined FFMPEG (
    echo.
    echo [ERROR] ffmpeg.exe was not found in PATH.
    echo.
    echo Add FFmpeg bin directory to PATH.
    exit /b 1
)

echo.
echo Python:
echo   %PYTHON%
echo.
echo FFmpeg:
echo   %FFMPEG%
echo.

exit /b 0


rem ============================================================
rem CHECK OFFLINE MODELS
rem ============================================================

:models

echo.
echo [1/6] Checking all offline AI models...

call "%MODEL_SCRIPT%"

if errorlevel 1 (
    echo.
    echo [ERROR] Offline model verification failed.
    exit /b 1
)

exit /b 0


rem ============================================================
rem PRESERVE PACKAGED AI
rem ============================================================

:preserve_packaged_ai

if /I "%BUILD_MODE%"=="clean" (
    exit /b 0
)

set "CURRENT_MODELS=%BACKEND_DIST%\_internal\models"
set "CURRENT_MSST=%BACKEND_DIST%\_internal\engines\msst"

rem Start from an empty preservation area.

if exist "%PRESERVED_AI%\" (
    call :remove_directory "%PRESERVED_AI%"
    if errorlevel 1 exit /b 1
)

if not exist "%PRESERVED_AI%\" (
    mkdir "%PRESERVED_AI%" >nul 2>&1

    if errorlevel 1 (
        echo.
        echo [ERROR] Could not create AI preservation directory:
        echo   %PRESERVED_AI%
        exit /b 1
    )
)

rem ------------------------------------------------------------
rem Models
rem ------------------------------------------------------------

if exist "%CURRENT_MODELS%\" (

    echo.
    echo Preserving existing packaged AI models...
    echo   FROM: %CURRENT_MODELS%
    echo   TO:   %PRESERVED_MODELS%
    echo.

    move "%CURRENT_MODELS%" "%PRESERVED_MODELS%" >nul

    if errorlevel 1 (
        echo.
        echo [ERROR] Could not preserve packaged AI models.
        exit /b 1
    )
)

rem ------------------------------------------------------------
rem MSST
rem ------------------------------------------------------------

if exist "%CURRENT_MSST%\" (

    echo Preserving existing packaged MSST engine...

    move "%CURRENT_MSST%" "%PRESERVED_MSST%" >nul

    if errorlevel 1 (
        echo.
        echo [ERROR] Could not preserve packaged MSST engine.
        exit /b 1
    )
)

exit /b 0


rem ============================================================
rem RESTORE PACKAGED AI
rem ============================================================

:restore_packaged_ai

if /I "%BUILD_MODE%"=="clean" (
    exit /b 0
)

rem ------------------------------------------------------------
rem Models
rem ------------------------------------------------------------

if exist "%PRESERVED_MODELS%\" (

    echo.
    echo Restoring preserved AI models...

    if not exist "%BACKEND_DIST%\_internal\" (
        mkdir "%BACKEND_DIST%\_internal" >nul 2>&1

        if errorlevel 1 (
            echo.
            echo [ERROR] Could not create backend internal directory.
            exit /b 1
        )
    )

    if exist "%BACKEND_DIST%\_internal\models\" (
        call :remove_directory "%BACKEND_DIST%\_internal\models"
        if errorlevel 1 exit /b 1
    )

    move "%PRESERVED_MODELS%" "%BACKEND_DIST%\_internal\models" >nul

    if errorlevel 1 (
        echo.
        echo [ERROR] Could not restore packaged AI models.
        exit /b 1
    )

    echo   AI models restored.
)

rem ------------------------------------------------------------
rem MSST
rem ------------------------------------------------------------

if exist "%PRESERVED_MSST%\" (

    echo Restoring preserved MSST inference engine...

    if not exist "%BACKEND_DIST%\_internal\engines\" (
        mkdir "%BACKEND_DIST%\_internal\engines" >nul 2>&1

        if errorlevel 1 (
            echo.
            echo [ERROR] Could not create packaged engines directory.
            exit /b 1
        )
    )

    if exist "%BACKEND_DIST%\_internal\engines\msst\" (
        call :remove_directory "%BACKEND_DIST%\_internal\engines\msst"
        if errorlevel 1 exit /b 1
    )

    move "%PRESERVED_MSST%" "%BACKEND_DIST%\_internal\engines\msst" >nul

    if errorlevel 1 (
        echo.
        echo [ERROR] Could not restore packaged MSST engine.
        exit /b 1
    )

    echo   MSST engine restored.
)

rem Remove empty preservation directory.

if exist "%PRESERVED_AI%\" (
    rmdir "%PRESERVED_AI%" >nul 2>&1
)

exit /b 0


rem ============================================================
rem BUILD PYTHON BACKEND
rem ============================================================

:backend

echo.
echo [2/6] Building Python executables...

"%PYTHON%" -m PyInstaller --version >nul 2>&1

if errorlevel 1 (

    echo.
    echo PyInstaller is not installed. Installing...
    echo.

    "%PYTHON%" -m pip install pyinstaller

    if errorlevel 1 (
        echo.
        echo [ERROR] PyInstaller installation failed.
        exit /b 1
    )
)

for /f "delims=" %%V in ('"%PYTHON%" -m PyInstaller --version') do (
    echo PyInstaller version: %%V
)

pushd "%BACKEND%"

if errorlevel 1 (
    echo.
    echo [ERROR] Could not open backend directory:
    echo   %BACKEND%
    exit /b 1
)

echo.
echo Building KaraokeBackend.exe...
echo.

"%PYTHON%" -m PyInstaller ^
    --log-level ERROR ^
    --noconfirm ^
    %PYINSTALLER_CLEAN% ^
    --onedir ^
    --name KaraokeBackend ^
    --distpath "%BUILD%\backend\dist" ^
    --workpath "%BUILD%\backend\pyinstaller\KaraokeBackend" ^
    --specpath "%BUILD%\backend\spec" ^
    --paths "%BACKEND%\AI" ^
    --paths "%MSST_ENGINE%" ^
    --add-data "%BACKEND%\AI;AI" ^
    --add-binary "%FFMPEG%;." ^
    --hidden-import run_all ^
    --collect-submodules omegaconf ^
    --collect-submodules ml_collections ^
    --collect-submodules beartype ^
    --collect-submodules rotary_embedding_torch ^
    --collect-submodules matplotlib ^
    run.py

if errorlevel 1 (
    popd

    echo.
    echo [ERROR] KaraokeBackend PyInstaller build failed.
    exit /b 1
)

rem ============================================================
rem Restore preserved models BEFORE creating helper executable.
rem ============================================================

call :restore_packaged_ai

if errorlevel 1 (
    popd
    exit /b 1
)

echo.
echo Building KaraokeAudioMonitor.exe...
echo.

"%PYTHON%" -m PyInstaller ^
    --log-level ERROR ^
    --noconfirm ^
    %PYINSTALLER_CLEAN% ^
    --onefile ^
    --name KaraokeAudioMonitor ^
    --distpath "%BACKEND_DIST%" ^
    --workpath "%BUILD%\backend\audio-monitor" ^
    --specpath "%BUILD%\backend\spec" ^
    --paths "%BACKEND%" ^
    app\services\monitor_worker.py

if errorlevel 1 (
    popd

    echo.
    echo [ERROR] KaraokeAudioMonitor build failed.
    exit /b 1
)

popd

call :require_file "%BACKEND_DIST%\KaraokeBackend.exe" "KaraokeBackend.exe"
if errorlevel 1 exit /b 1

call :require_file "%BACKEND_DIST%\KaraokeAudioMonitor.exe" "KaraokeAudioMonitor.exe"
if errorlevel 1 exit /b 1

exit /b 0


rem ============================================================
rem BUILD ASIO BRIDGE
rem ============================================================

:asio

call :asio_compile
if errorlevel 1 exit /b 1

call :asio_finalize
if errorlevel 1 exit /b 1

exit /b 0


rem ============================================================
rem COMPILE ASIO BRIDGE
rem ============================================================

:asio_compile

echo.
echo [3/6] Compiling native ASIO bridge...

call "%VCVARS%" >nul

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to initialize Visual C++ environment.
    exit /b 1
)

"%CMAKE%" ^
    -S "%ASIO%" ^
    -B "%ASIO_BUILD%" ^
    -G Ninja ^
    -DCMAKE_BUILD_TYPE=Release ^
    -DASIO_SDK_DIR="%ASIO_SDK%" ^
    -DCMAKE_MAKE_PROGRAM="%NINJA%"

if errorlevel 1 (
    echo.
    echo [ERROR] ASIO CMake configuration failed.
    exit /b 1
)

rem Ninja itself builds independent C/C++ compilation units in parallel.
"%CMAKE%" --build "%ASIO_BUILD%" --parallel

if errorlevel 1 (
    echo.
    echo [ERROR] ASIO compilation failed.
    exit /b 1
)

call :require_file "%ASIO_BUILD%\KaraokeAsioBridge.exe" "Compiled KaraokeAsioBridge.exe"
if errorlevel 1 exit /b 1

exit /b 0


rem ============================================================
rem FINALIZE ASIO + SIGN BACKEND
rem ============================================================

:asio_finalize

echo.
echo Finalizing ASIO bridge and signing backend executables...

call :require_file "%ASIO_BUILD%\KaraokeAsioBridge.exe" "Compiled KaraokeAsioBridge.exe"
if errorlevel 1 exit /b 1

call :require_directory "%BACKEND_DIST%" "Packaged backend directory"
if errorlevel 1 exit /b 1

copy /Y ^
    "%ASIO_BUILD%\KaraokeAsioBridge.exe" ^
    "%BACKEND_DIST%\KaraokeAsioBridge.exe" >nul

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to copy KaraokeAsioBridge.exe.
    exit /b 1
)

call :sign_file "%BACKEND_DIST%\KaraokeBackend.exe"
if errorlevel 1 exit /b 1

call :sign_file "%BACKEND_DIST%\KaraokeAudioMonitor.exe"
if errorlevel 1 exit /b 1

call :sign_file "%BACKEND_DIST%\KaraokeAsioBridge.exe"
if errorlevel 1 exit /b 1

exit /b 0


rem ============================================================
rem PACKAGE OFFLINE MODELS
rem ============================================================

:package_models

echo.
echo [4/6] Checking offline AI model folders...

call :require_directory "%BACKEND_DIST%\_internal" "PyInstaller internal directory"
if errorlevel 1 exit /b 1

call :require_directory "%MODELS%" "Offline AI models directory"
if errorlevel 1 exit /b 1

if not exist "%BACKEND_DIST%\_internal\models\" (

    mkdir "%BACKEND_DIST%\_internal\models" >nul 2>&1

    if errorlevel 1 (
        echo.
        echo [ERROR] Could not create packaged models directory:
        echo   %BACKEND_DIST%\_internal\models
        exit /b 1
    )
)

echo.
echo Models source:
echo   %MODELS%
echo.
echo Model destination:
echo   %BACKEND_DIST%\_internal\models
echo.
echo Any new first-level model folder is detected automatically.
echo Existing unchanged folders remain exactly where they are.
echo Unchanged folders are skipped completely.
echo Changed folders are synchronized individually.
echo Only changed files inside a changed folder are copied.
echo.

call :sync_model_tree
if errorlevel 1 exit /b 1

rem MSST is an inference engine, not a model directory.

call :sync_directory_if_changed ^
    "%MSST_ENGINE%" ^
    "%BACKEND_DIST%\_internal\engines\msst" ^
    "MSST inference engine"

if errorlevel 1 exit /b 1

call :verify_backend_dist
if errorlevel 1 exit /b 1

exit /b 0


rem ============================================================
rem VERIFY BACKEND BASE
rem ============================================================

:verify_backend_base

call :require_file "%BACKEND_DIST%\KaraokeBackend.exe" "KaraokeBackend.exe"
if errorlevel 1 exit /b 1

call :require_file "%BACKEND_DIST%\KaraokeAudioMonitor.exe" "KaraokeAudioMonitor.exe"
if errorlevel 1 exit /b 1

call :require_file "%BACKEND_DIST%\KaraokeAsioBridge.exe" "KaraokeAsioBridge.exe"
if errorlevel 1 exit /b 1

call :require_directory "%BACKEND_DIST%\_internal" "PyInstaller internal directory"
if errorlevel 1 exit /b 1

exit /b 0


rem ============================================================
rem VERIFY PACKAGED BACKEND
rem ============================================================

:verify_backend_dist

call :verify_backend_base
if errorlevel 1 exit /b 1

call :require_directory ^
    "%BACKEND_DIST%\_internal\models" ^
    "Packaged AI models directory"

if errorlevel 1 exit /b 1

call :verify_model_tree ^
    "%BACKEND_DIST%\_internal\models" ^
    "Packaged backend AI models"

if errorlevel 1 exit /b 1

call :require_file ^
    "%BACKEND_DIST%\_internal\engines\msst\inference.py" ^
    "Packaged MSST engine"

if errorlevel 1 exit /b 1

exit /b 0


rem ============================================================
rem BUILD ELECTRON
rem ============================================================

:electron

call :frontend_build
if errorlevel 1 exit /b 1

call :electron_package
if errorlevel 1 exit /b 1

exit /b 0


rem ============================================================
rem BUILD REACT FRONTEND
rem ============================================================

:frontend_build

echo.
echo [5/6] Building React frontend...

pushd "%FRONTEND%"

if errorlevel 1 (
    echo.
    echo [ERROR] Could not open frontend directory:
    echo   %FRONTEND%
    exit /b 1
)

call npm run build

if errorlevel 1 (
    popd
    echo.
    echo [ERROR] React frontend build failed.
    exit /b 1
)

popd

exit /b 0


rem ============================================================
rem PACKAGE ELECTRON
rem ============================================================

:electron_package

echo.
echo [5/6] Building complete Electron application...

call :require_file "%SCENE_VIDEO_SOURCE%" "Karaoke scene video"
if errorlevel 1 exit /b 1

call :remove_directory "%UNPACKED%"
if errorlevel 1 exit /b 1

pushd "%FRONTEND%"

if errorlevel 1 (
    echo.
    echo [ERROR] Could not open frontend directory:
    echo   %FRONTEND%
    exit /b 1
)

echo.
echo Building Electron win-unpacked directory...
echo.

call npx electron-builder --win --x64 --dir

if errorlevel 1 (
    popd
    echo.
    echo [ERROR] Electron win-unpacked build failed.
    exit /b 1
)

popd

call :sign_file "%UNPACKED%\%APP_EXE%"
if errorlevel 1 exit /b 1

call :verify_unpacked
if errorlevel 1 exit /b 1

echo.
echo Electron package verified successfully.

exit /b 0


rem ============================================================
rem VERIFY ELECTRON PACKAGE
rem ============================================================

:verify_unpacked

call :require_file ^
    "%UNPACKED%\%APP_EXE%" ^
    "Electron application"

if errorlevel 1 exit /b 1

call :require_file ^
    "%PACKAGED_SCENE_VIDEO%" ^
    "Karaoke scene video"

if errorlevel 1 exit /b 1

call :require_file ^
    "%PACKAGED_BACKEND%\KaraokeBackend.exe" ^
    "Electron backend"

if errorlevel 1 exit /b 1

call :require_file ^
    "%PACKAGED_BACKEND%\KaraokeAudioMonitor.exe" ^
    "Electron audio monitor"

if errorlevel 1 exit /b 1

call :require_file ^
    "%PACKAGED_BACKEND%\KaraokeAsioBridge.exe" ^
    "Electron ASIO bridge"

if errorlevel 1 exit /b 1

call :require_directory ^
    "%PACKAGED_BACKEND%\_internal\models" ^
    "Electron AI models directory"

if errorlevel 1 exit /b 1

call :verify_model_tree ^
    "%PACKAGED_BACKEND%\_internal\models" ^
    "Electron packaged AI models"

if errorlevel 1 exit /b 1

call :require_file ^
    "%PACKAGED_BACKEND%\_internal\engines\msst\inference.py" ^
    "Electron MSST engine"

if errorlevel 1 exit /b 1

exit /b 0


rem ============================================================
rem BUILD INNO SETUP INSTALLER
rem ============================================================

:installer

echo.
echo [6/6] Building complete offline installer...

call :find_inno

if not defined INNO_COMPILER (

    echo.
    echo [ERROR] Inno Setup compiler was not found.
    echo.
    echo Install Inno Setup 6.
    echo.
    echo Existing built files were NOT deleted.
    echo.
    echo After installing Inno Setup run:
    echo.
    echo   build-installer.bat installer
    echo.

    exit /b 1
)

echo.
echo Inno Setup:
echo   %INNO_COMPILER%
echo.

call :remove_directory "%INSTALLER_DIR%"
if errorlevel 1 exit /b 1

call :remove_directory "%TEMP_DIR%"
if errorlevel 1 exit /b 1

mkdir "%INSTALLER_DIR%" >nul 2>&1

if errorlevel 1 (
    echo.
    echo [ERROR] Could not create installer directory:
    echo   %INSTALLER_DIR%
    exit /b 1
)

mkdir "%TEMP_DIR%" >nul 2>&1

if errorlevel 1 (
    echo.
    echo [ERROR] Could not create temporary installer directory:
    echo   %TEMP_DIR%
    exit /b 1
)

"%INNO_COMPILER%" ^
    /DMyAppName="%APP_NAME%" ^
    /DMyAppVersion="%APP_VERSION%" ^
    /DMyAppExeName="%APP_EXE%" ^
    /DMyAppId="%APP_ID%" ^
    /DSetupIcon="%SETUP_ICON%" ^
    /DSourceDir="%UNPACKED%" ^
    /DOutputDir="%INSTALLER_DIR%" ^
    "%INNO_TEMPLATE%"

if errorlevel 1 (
    echo.
    echo [ERROR] Inno Setup compilation failed.
    exit /b 1
)

call :require_file "%INSTALLER_EXE%" "Installer executable"
if errorlevel 1 exit /b 1

call :sign_file "%INSTALLER_EXE%"
if errorlevel 1 exit /b 1

dir /B "%INSTALLER_DIR%\*.bin" >nul 2>&1

if errorlevel 1 (
    echo.
    echo [ERROR] Installer .bin data files were not created.
    exit /b 1
)

exit /b 0


rem ============================================================
rem SHA-256 CHECKSUMS
rem ============================================================

:checksums

echo.
echo Creating SHA-256 checksums...

powershell ^
    -NoProfile ^
    -ExecutionPolicy Bypass ^
    -File "%ROOT%scripts\generate-checksums.ps1" ^
    -InstallerDirectory "%INSTALLER_DIR%" ^
    -OutputFile "%CHECKSUM_FILE%"

if errorlevel 1 (
    echo.
    echo [ERROR] Could not create SHA-256 checksums.
    exit /b 1
)

call :require_file "%CHECKSUM_FILE%" "SHA-256 checksum file"
if errorlevel 1 exit /b 1

exit /b 0


rem ============================================================
rem SYNC MODEL TREE
rem ============================================================

:sync_model_tree

set "MODEL_DEST=%BACKEND_DIST%\_internal\models"

rem ============================================================
rem Process each first-level model folder separately.
rem
rem IMPORTANT FIX:
rem Previous code effectively used:
rem
rem   %MODEL_DEST%%%~nxD
rem
rem producing:
rem
rem   ...\modelsctc
rem
rem instead of:
rem
rem   ...\models\ctc
rem ============================================================

for /D %%D in ("%MODELS%\*") do (

    call :sync_directory_if_changed ^
        "%%~fD" ^
        "%MODEL_DEST%\%%~nxD" ^
        "AI model %%~nxD"

    if errorlevel 1 exit /b 1
)

rem ============================================================
rem Files located directly in downloads\models
rem ============================================================

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference='Stop';" ^
    "$src=[IO.Path]::GetFullPath($env:MODELS);" ^
    "$dst=[IO.Path]::GetFullPath($env:MODEL_DEST);" ^
    "$files=@(Get-ChildItem -LiteralPath $src -File -Force);" ^
    "foreach($file in $files) {" ^
    "  $target=Join-Path $dst $file.Name;" ^
    "  $copy=$true;" ^
    "  if(Test-Path -LiteralPath $target -PathType Leaf) {" ^
    "    $existing=Get-Item -LiteralPath $target -Force;" ^
    "    $sourceSeconds=[int64]($file.LastWriteTimeUtc.Ticks / 10000000);" ^
    "    $targetSeconds=[int64]($existing.LastWriteTimeUtc.Ticks / 10000000);" ^
    "    $copy=($existing.Length -ne $file.Length -or $sourceSeconds -ne $targetSeconds);" ^
    "  }" ^
    "  if($copy) {" ^
    "    Write-Host ('  Updating model file: ' + $file.Name);" ^
    "    Copy-Item -LiteralPath $file.FullName -Destination $target -Force;" ^
    "    (Get-Item -LiteralPath $target -Force).LastWriteTimeUtc=$file.LastWriteTimeUtc;" ^
    "  } else {" ^
    "    Write-Host ('  Model file ' + $file.Name + ': unchanged [skip]');" ^
    "  }" ^
    "}"

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to synchronize files from downloads\models.
    exit /b 1
)

rem ============================================================
rem Remove model folders/files that were removed from source.
rem ============================================================

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference='Stop';" ^
    "$src=[IO.Path]::GetFullPath($env:MODELS);" ^
    "$dst=[IO.Path]::GetFullPath($env:MODEL_DEST);" ^
    "if(Test-Path -LiteralPath $dst -PathType Container) {" ^
    "  Get-ChildItem -LiteralPath $dst -Force | ForEach-Object {" ^
    "    $sourceItem=Join-Path $src $_.Name;" ^
    "    if(-not (Test-Path -LiteralPath $sourceItem)) {" ^
    "      Write-Host ('  Removing stale packaged model: ' + $_.Name);" ^
    "      Remove-Item -LiteralPath $_.FullName -Recurse -Force;" ^
    "    }" ^
    "  }" ^
    "}"

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to remove stale packaged models.
    exit /b 1
)

call :verify_model_tree "%MODEL_DEST%" "Packaged AI models"
if errorlevel 1 exit /b 1

exit /b 0


rem ============================================================
rem SYNC DIRECTORY ONLY WHEN CHANGED
rem ============================================================

:sync_directory_if_changed

set "SYNC_SRC=%~1"
set "SYNC_DST=%~2"
set "SYNC_LABEL=%~3"

call :require_directory "%SYNC_SRC%" "%SYNC_LABEL%"
if errorlevel 1 exit /b 1

rem ============================================================
rem FAST METADATA SNAPSHOT
rem ============================================================
rem
rem We DO NOT hash/read multi-GB model weights.
rem
rem Compare:
rem
rem   relative path
rem   file size
rem   modification timestamp rounded to one second
rem
rem Rounding avoids false differences caused by tiny filesystem
rem timestamp precision differences.
rem ============================================================

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference='Stop';" ^
    "$src=[IO.Path]::GetFullPath($env:SYNC_SRC).TrimEnd('\');" ^
    "$dst=[IO.Path]::GetFullPath($env:SYNC_DST).TrimEnd('\');" ^
    "if(-not (Test-Path -LiteralPath $dst -PathType Container)) { exit 10 };" ^
    "function Snapshot([string]$root) {" ^
    "  @(" ^
    "    Get-ChildItem -LiteralPath $root -Recurse -File -Force |" ^
    "    ForEach-Object {" ^
    "      $relative=$_.FullName.Substring($root.Length).TrimStart('\').ToLowerInvariant();" ^
    "      $seconds=[int64]($_.LastWriteTimeUtc.Ticks / 10000000);" ^
    "      $relative + '|' + $_.Length + '|' + $seconds" ^
    "    } | Sort-Object" ^
    "  )" ^
    "};" ^
    "$sourceSnapshot=Snapshot $src;" ^
    "$targetSnapshot=Snapshot $dst;" ^
    "if($sourceSnapshot.Count -ne $targetSnapshot.Count) { exit 11 };" ^
    "for($i=0;$i -lt $sourceSnapshot.Count;$i++) {" ^
    "  if($sourceSnapshot[$i] -cne $targetSnapshot[$i]) { exit 12 }" ^
    "};" ^
    "exit 0"

set "SYNC_COMPARE_CODE=!ERRORLEVEL!"

rem ------------------------------------------------------------
rem Perfect match
rem ------------------------------------------------------------

if "!SYNC_COMPARE_CODE!"=="0" (
    echo   %SYNC_LABEL%: unchanged [skip]
    exit /b 0
)

rem ------------------------------------------------------------
rem Unexpected PowerShell failure
rem ------------------------------------------------------------

if !SYNC_COMPARE_CODE! GEQ 20 (
    echo.
    echo [ERROR] Could not compare %SYNC_LABEL%.
    echo.
    echo Source:
    echo   %SYNC_SRC%
    echo.
    echo Destination:
    echo   %SYNC_DST%
    exit /b 1
)

rem ------------------------------------------------------------
rem Explain reason
rem ------------------------------------------------------------

if "!SYNC_COMPARE_CODE!"=="10" (
    echo   %SYNC_LABEL%: new - synchronizing...
) else (
    echo   %SYNC_LABEL%: changed - synchronizing...
)

if not exist "%SYNC_DST%\" (

    mkdir "%SYNC_DST%" >nul 2>&1

    if errorlevel 1 (
        echo.
        echo [ERROR] Could not create:
        echo   %SYNC_DST%
        exit /b 1
    )
)

rem ============================================================
rem SYNCHRONIZE
rem ============================================================
rem
rem Robocopy itself only copies changed/new files.
rem Existing equal model files stay untouched.
rem
rem /MIR       mirror tree
rem /COPY:DAT  data, attributes, timestamps
rem /DCOPY:DAT directory metadata
rem /J         unbuffered I/O for large model files
rem /MT:16     multi-threaded copy
rem ============================================================

robocopy "%SYNC_SRC%" "%SYNC_DST%" ^
    /MIR ^
    /COPY:DAT ^
    /DCOPY:DAT ^
    /R:2 ^
    /W:1 ^
    /MT:16 ^
    /J ^
    /NFL ^
    /NDL ^
    /NJH ^
    /NJS ^
    /NP

set "ROBOCOPY_CODE=!ERRORLEVEL!"

if !ROBOCOPY_CODE! GEQ 8 (
    echo.
    echo [ERROR] Failed to synchronize %SYNC_LABEL%.
    echo.
    echo Robocopy exit code:
    echo   !ROBOCOPY_CODE!
    exit /b 1
)

rem ============================================================
rem VERIFY AFTER SYNC
rem ============================================================

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference='Stop';" ^
    "$src=[IO.Path]::GetFullPath($env:SYNC_SRC).TrimEnd('\');" ^
    "$dst=[IO.Path]::GetFullPath($env:SYNC_DST).TrimEnd('\');" ^
    "function Snapshot([string]$root) {" ^
    "  @(" ^
    "    Get-ChildItem -LiteralPath $root -Recurse -File -Force |" ^
    "    ForEach-Object {" ^
    "      $relative=$_.FullName.Substring($root.Length).TrimStart('\').ToLowerInvariant();" ^
    "      $seconds=[int64]($_.LastWriteTimeUtc.Ticks / 10000000);" ^
    "      $relative + '|' + $_.Length + '|' + $seconds" ^
    "    } | Sort-Object" ^
    "  )" ^
    "};" ^
    "$sourceSnapshot=Snapshot $src;" ^
    "$targetSnapshot=Snapshot $dst;" ^
    "if($sourceSnapshot.Count -ne $targetSnapshot.Count) { exit 1 };" ^
    "for($i=0;$i -lt $sourceSnapshot.Count;$i++) {" ^
    "  if($sourceSnapshot[$i] -cne $targetSnapshot[$i]) { exit 1 }" ^
    "};" ^
    "exit 0"

if errorlevel 1 (
    echo.
    echo [ERROR] %SYNC_LABEL% still differs after synchronization.
    exit /b 1
)

echo   %SYNC_LABEL%: synchronized

exit /b 0


rem ============================================================
rem VERIFY MODEL TREE
rem ============================================================

:verify_model_tree

set "VERIFY_DEST=%~1"
set "VERIFY_LABEL=%~2"

call :require_directory "%MODELS%" "Offline AI models directory"
if errorlevel 1 exit /b 1

call :require_directory "%VERIFY_DEST%" "%VERIFY_LABEL%"
if errorlevel 1 exit /b 1

rem ============================================================
rem Lightweight verification.
rem
rem No SHA-256 here because reading all multi-GB files every build
rem would defeat the purpose of fast incremental builds.
rem
rem Model integrity itself is checked by ensure-offline-models.
rem ============================================================

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference='Stop';" ^
    "$src=[IO.Path]::GetFullPath($env:MODELS).TrimEnd('\');" ^
    "$dst=[IO.Path]::GetFullPath($env:VERIFY_DEST).TrimEnd('\');" ^
    "$source=@(Get-ChildItem -LiteralPath $src -Recurse -File -Force);" ^
    "$target=@(Get-ChildItem -LiteralPath $dst -Recurse -File -Force);" ^
    "if($source.Count -ne $target.Count) {" ^
    "  throw ('Model file count differs: source=' + $source.Count + ', packaged=' + $target.Count);" ^
    "};" ^
    "$bytes=[int64]0;" ^
    "foreach($file in $source) {" ^
    "  $relative=$file.FullName.Substring($src.Length).TrimStart('\');" ^
    "  $copy=Join-Path $dst $relative;" ^
    "  if(-not (Test-Path -LiteralPath $copy -PathType Leaf)) {" ^
    "    throw ('Missing: ' + $relative);" ^
    "  };" ^
    "  $packaged=Get-Item -LiteralPath $copy -Force;" ^
    "  if($packaged.Length -ne $file.Length) {" ^
    "    throw ('Different size: ' + $relative);" ^
    "  };" ^
    "  $bytes += $file.Length;" ^
    "};" ^
    "$gb=[Math]::Round($bytes / 1GB,2);" ^
    "Write-Host ('  Model tree verified: ' + $source.Count + ' files, ' + $gb + ' GB.');"

if errorlevel 1 (
    echo.
    echo [ERROR] %VERIFY_LABEL% differs from downloads\models.
    exit /b 1
)

exit /b 0


rem ============================================================
rem PARALLEL BUILD ORCHESTRATION
rem ============================================================

:parallel_full_build

echo.
echo ============================================================
echo  PARALLEL BUILD
echo ============================================================
echo.
echo Running simultaneously:
echo   [A] Python backend
echo   [B] Native ASIO compilation
echo   [C] React frontend
echo.

call :prepare_parallel_dir
if errorlevel 1 exit /b 1

start "" /B cmd.exe /D /C call "%~f0" __worker_backend "%BUILD_MODE%"
start "" /B cmd.exe /D /C call "%~f0" __worker_asio "%BUILD_MODE%"
start "" /B cmd.exe /D /C call "%~f0" __worker_frontend "%BUILD_MODE%"

call :wait_parallel_results backend asio frontend
if errorlevel 1 exit /b 1

echo.
echo Parallel build stage completed successfully.

exit /b 0


:parallel_fast_build

echo.
echo ============================================================
echo  PARALLEL FAST BUILD
echo ============================================================
echo.
echo Running simultaneously:
echo   [A] AI model synchronization
echo   [B] React frontend
echo.

call :prepare_parallel_dir
if errorlevel 1 exit /b 1

start "" /B cmd.exe /D /C call "%~f0" __worker_package_models "%BUILD_MODE%"
start "" /B cmd.exe /D /C call "%~f0" __worker_frontend "%BUILD_MODE%"

call :wait_parallel_results package_models frontend
if errorlevel 1 exit /b 1

echo.
echo Parallel fast stage completed successfully.

exit /b 0


:prepare_parallel_dir

if exist "%PARALLEL_DIR%\" (
    call :remove_directory "%PARALLEL_DIR%"
    if errorlevel 1 exit /b 1
)

mkdir "%PARALLEL_DIR%" >nul 2>&1

if errorlevel 1 (
    echo.
    echo [ERROR] Could not create parallel build directory:
    echo   %PARALLEL_DIR%
    exit /b 1
)

exit /b 0


:wait_parallel_results

set "PARALLEL_JOB_1=%~1"
set "PARALLEL_JOB_2=%~2"
set "PARALLEL_JOB_3=%~3"
set /A "PARALLEL_WAIT_SECONDS=0"

:wait_parallel_results_loop

set "PARALLEL_ALL_DONE=1"

if defined PARALLEL_JOB_1 (
    if not exist "%PARALLEL_DIR%\!PARALLEL_JOB_1!.exit" set "PARALLEL_ALL_DONE=0"
)

if defined PARALLEL_JOB_2 (
    if not exist "%PARALLEL_DIR%\!PARALLEL_JOB_2!.exit" set "PARALLEL_ALL_DONE=0"
)

if defined PARALLEL_JOB_3 (
    if not exist "%PARALLEL_DIR%\!PARALLEL_JOB_3!.exit" set "PARALLEL_ALL_DONE=0"
)

if "!PARALLEL_ALL_DONE!"=="1" goto :wait_parallel_results_done

rem Guard against a worker process dying before it can write its result file.
set /A "PARALLEL_WAIT_SECONDS+=1"

if !PARALLEL_WAIT_SECONDS! GEQ 7200 (
    echo.
    echo [ERROR] Parallel build worker did not report completion.
    exit /b 1
)

timeout /t 1 /nobreak >nul
goto :wait_parallel_results_loop


:wait_parallel_results_done

set "PARALLEL_FAILED=0"

for %%J in ("%PARALLEL_JOB_1%" "%PARALLEL_JOB_2%" "%PARALLEL_JOB_3%") do (
    if not "%%~J"=="" (
        set "PARALLEL_CODE="
        set /P "PARALLEL_CODE="<"%PARALLEL_DIR%\%%~J.exit"

        if not "!PARALLEL_CODE!"=="0" (
            echo.
            echo [ERROR] Parallel worker failed: %%~J
            echo Exit code: !PARALLEL_CODE!
            set "PARALLEL_FAILED=1"
        )
    )
)

if "!PARALLEL_FAILED!"=="1" exit /b 1

exit /b 0


rem ============================================================
rem INTERNAL PARALLEL WORKERS
rem ============================================================

:parallel_worker_backend

call :backend
set "WORKER_EXIT=!ERRORLEVEL!"

if not exist "%PARALLEL_DIR%\" mkdir "%PARALLEL_DIR%" >nul 2>&1
> "%PARALLEL_DIR%\backend.exit" echo !WORKER_EXIT!

exit /b !WORKER_EXIT!


:parallel_worker_asio

call :asio_compile
set "WORKER_EXIT=!ERRORLEVEL!"

if not exist "%PARALLEL_DIR%\" mkdir "%PARALLEL_DIR%" >nul 2>&1
> "%PARALLEL_DIR%\asio.exit" echo !WORKER_EXIT!

exit /b !WORKER_EXIT!


:parallel_worker_frontend

call :frontend_build
set "WORKER_EXIT=!ERRORLEVEL!"

if not exist "%PARALLEL_DIR%\" mkdir "%PARALLEL_DIR%" >nul 2>&1
> "%PARALLEL_DIR%\frontend.exit" echo !WORKER_EXIT!

exit /b !WORKER_EXIT!


:parallel_worker_package_models

call :package_models
set "WORKER_EXIT=!ERRORLEVEL!"

if not exist "%PARALLEL_DIR%\" mkdir "%PARALLEL_DIR%" >nul 2>&1
> "%PARALLEL_DIR%\package_models.exit" echo !WORKER_EXIT!

exit /b !WORKER_EXIT!


rem ============================================================
rem GENERIC DIRECTORY COPY
rem ============================================================

:copy_directory

call :require_directory "%~1" "%~3"
if errorlevel 1 exit /b 1

robocopy "%~1" "%~2" ^
    /E ^
    /COPY:DAT ^
    /DCOPY:DAT ^
    /R:2 ^
    /W:1 ^
    /MT:16 ^
    /NFL ^
    /NDL ^
    /NJH ^
    /NJS ^
    /NP

set "ROBOCOPY_CODE=!ERRORLEVEL!"

if !ROBOCOPY_CODE! GEQ 8 (
    echo.
    echo [ERROR] Failed to copy %~3.
    echo Robocopy exit code: !ROBOCOPY_CODE!
    exit /b 1
)

exit /b 0


rem ============================================================
rem SIGN FILE
rem ============================================================

:sign_file

if not exist "%SIGN_SCRIPT%" (
    echo.
    echo [ERROR] Signing script was not found:
    echo   %SIGN_SCRIPT%
    exit /b 1
)

powershell ^
    -NoProfile ^
    -ExecutionPolicy Bypass ^
    -File "%SIGN_SCRIPT%" ^
    -Path "%~1"

if errorlevel 1 (
    echo.
    echo [ERROR] Code signing failed for:
    echo   %~1
    exit /b 1
)

exit /b 0


rem ============================================================
rem REQUIRE FILE
rem ============================================================

:require_file

if exist "%~1" (
    exit /b 0
)

echo.
echo [ERROR] %~2 was not found:
echo   %~1

exit /b 1


rem ============================================================
rem REQUIRE DIRECTORY
rem ============================================================

:require_directory

if exist "%~1\" (
    exit /b 0
)

echo.
echo [ERROR] %~2 was not found:
echo   %~1

exit /b 1


rem ============================================================
rem REMOVE DIRECTORY
rem ============================================================

:remove_directory

set "REMOVE_TARGET=%~1"

if not defined REMOVE_TARGET (
    echo.
    echo [ERROR] Refusing to remove an empty path.
    exit /b 1
)

if not exist "%REMOVE_TARGET%\" (
    exit /b 0
)

echo Removing:
echo   %REMOVE_TARGET%

rem Windows can release app.asar / DLL handles asynchronously.
rem Retry several times before failing.

for /L %%I in (1,1,10) do (

    rmdir /S /Q "%REMOVE_TARGET%" >nul 2>&1

    if not exist "%REMOVE_TARGET%\" (
        exit /b 0
    )

    echo   Directory is still locked. Retry %%I/10...

    rem --------------------------------------------------------
    rem If release folder is locked, retry stopping app helpers.
    rem --------------------------------------------------------

    if /I "%REMOVE_TARGET%"=="%RELEASE%" (

        taskkill /F /T /IM "%APP_EXE%" >nul 2>&1
        taskkill /F /T /IM KaraokeBackend.exe >nul 2>&1
        taskkill /F /T /IM KaraokeAudioMonitor.exe >nul 2>&1
        taskkill /F /T /IM KaraokeAsioBridge.exe >nul 2>&1

        powershell -NoProfile -ExecutionPolicy Bypass -Command ^
            "$release=[IO.Path]::GetFullPath($env:KARAOKE_RELEASE);" ^
            "Get-Process -ErrorAction SilentlyContinue | ForEach-Object {" ^
            "  try {" ^
            "    $path=$_.Path;" ^
            "    if($path) {" ^
            "      $full=[IO.Path]::GetFullPath($path);" ^
            "      if($full.StartsWith($release,[StringComparison]::OrdinalIgnoreCase)) {" ^
            "        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue;" ^
            "      }" ^
            "    }" ^
            "  } catch {}" ^
            "}"
    )

    timeout /t 2 /nobreak >nul
)

echo.
echo [ERROR] Could not remove directory:
echo   %REMOVE_TARGET%
echo.
echo A file in this directory is still being used by another process.
echo.
echo To find the locking process:
echo.
echo   1. Press Win+R
echo   2. Run: resmon
echo   3. Open CPU ^> Associated Handles
echo   4. Search for: app.asar
echo.

exit /b 1


rem ============================================================
rem FIND INNO SETUP
rem ============================================================

:find_inno

set "INNO_COMPILER="

rem Optional explicit override:
rem
rem set INNO_COMPILER_OVERRIDE=C:\Custom\Inno Setup 6\ISCC.exe

if defined INNO_COMPILER_OVERRIDE (
    call :try_inno_path "%INNO_COMPILER_OVERRIDE%"
)

if defined INNO_COMPILER (
    exit /b 0
)

set "INNO_PF86=%ProgramFiles(x86)%"
set "INNO_PF=%ProgramFiles%"

call :try_inno_path "%INNO_PF86%\Inno Setup 6\ISCC.exe"

if defined INNO_COMPILER (
    exit /b 0
)

call :try_inno_path "%INNO_PF%\Inno Setup 6\ISCC.exe"

if defined INNO_COMPILER (
    exit /b 0
)

call :try_inno_path "%INNO_PF86%\Inno Setup 7\ISCC.exe"

if defined INNO_COMPILER (
    exit /b 0
)

call :try_inno_path "%INNO_PF%\Inno Setup 7\ISCC.exe"

if defined INNO_COMPILER (
    exit /b 0
)

rem ------------------------------------------------------------
rem Registry - 64-bit
rem ------------------------------------------------------------

for /f "tokens=2,*" %%A in ('
    reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1" /v InstallLocation 2^>nul
') do (
    call :try_inno_path "%%~B\ISCC.exe"
)

if defined INNO_COMPILER (
    exit /b 0
)

rem ------------------------------------------------------------
rem Registry - WOW6432Node
rem ------------------------------------------------------------

for /f "tokens=2,*" %%A in ('
    reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1" /v InstallLocation 2^>nul
') do (
    call :try_inno_path "%%~B\ISCC.exe"
)

exit /b 0


rem ============================================================
rem TRY INNO PATH
rem ============================================================

:try_inno_path

if exist "%~1" (
    set "INNO_COMPILER=%~1"
)

exit /b 0


rem ============================================================
rem FAILURE
rem ============================================================

:failed

echo.
echo ============================================================
echo  BUILD FAILED
echo ============================================================
echo.
echo Check the first error shown above.
echo.

exit /b 1