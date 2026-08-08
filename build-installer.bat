@echo off
setlocal EnableExtensions EnableDelayedExpansion

title A^&D Voice - Complete Offline Installer Builder

rem ============================================================
rem BUILD MODES
rem ============================================================
rem
rem   build-installer.bat
rem       Rebuild backend, ASIO, models, Electron and installer.
rem       Reuses PyInstaller cache for faster repeated builds.
rem
rem   build-installer.bat fast
rem       Reuses build\backend\dist\KaraokeBackend.
rem       Rebuilds React, Electron and installer.
rem
rem   build-installer.bat installer
rem       Reuses build\electron\win-unpacked.
rem       Builds only the Inno Setup installer and checksums.
rem
rem   build-installer.bat clean
rem       Completely cleans PyInstaller output/cache and rebuilds all.
rem ============================================================

set "BUILD_MODE=%~1"

if not defined BUILD_MODE set "BUILD_MODE=full"

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

set "UNPACKED=%BUILD%\electron\win-unpacked"
set "INSTALLER_DIR=%RELEASE%"
set "TEMP_DIR=%BUILD%\installer"

set "PYTHON=%BACKEND%\venv\Scripts\python.exe"

set "BACKEND_DIST=%BUILD%\backend\dist\KaraokeBackend"
set "PACKAGED_BACKEND=%UNPACKED%\resources\backend"
set "SCENE_VIDEO_SOURCE=%DOWNLOADS%\media\videoplayback.mp4"
set "PACKAGED_SCENE_VIDEO=%UNPACKED%\resources\media\videoplayback.mp4"

set "ASIO=%BACKEND%\engines\asio"
set "ASIO_BUILD=%BUILD%\asio"
set "ASIO_SDK=%DOWNLOADS%\engines\asio-sdk"
set "MODELS=%DOWNLOADS%\models"
set "MSST_ENGINE=%DOWNLOADS%\engines\msst"

set "VS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools"
set "VCVARS=%VS%\VC\Auxiliary\Build\vcvars64.bat"
set "CMAKE=%VS%\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
set "NINJA=%VS%\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe"

set "APP_NAME=A&D Voice"
set "APP_VERSION=1.0.0"
set "APP_EXE=A&D Voice.exe"
set "APP_ID=E734496E-2622-5565-89D3-45451D9DE7EE"

set "MODEL_SCRIPT=%ROOT%scripts\ensure-offline-models.bat"
set "INNO_TEMPLATE=%ROOT%scripts\karaoke-studio.iss"
set "SIGN_SCRIPT=%ROOT%scripts\sign-windows.ps1"
set "SETUP_ICON=%FRONTEND%\assets\icons\app.ico"

set "INSTALLER_EXE=%INSTALLER_DIR%\A&D Voice Setup %APP_VERSION%.exe"
set "CHECKSUM_FILE=%INSTALLER_DIR%\SHA256SUMS.txt"
set "KARAOKE_INSTALLER_DIR=%INSTALLER_DIR%"
set "KARAOKE_CHECKSUM_FILE=%CHECKSUM_FILE%"

set "PYINSTALLER_CLEAN="
if /I "%BUILD_MODE%"=="clean" set "PYINSTALLER_CLEAN=--clean"

rem ============================================================
rem START
rem ============================================================

echo.
echo ============================================================
echo  A^&D - COMPLETE OFFLINE INSTALLER
echo ============================================================
echo.
echo Build mode:
echo   %BUILD_MODE%
echo.
echo Project:
echo   %ROOT%
echo.
echo Build intermediates: %BUILD%
echo Downloaded resources: %DOWNLOADS%
echo Final release only: %RELEASE%
echo.

call :stop_build_processes
if errorlevel 1 goto :failed

call :environment
if errorlevel 1 goto :failed

call :prepare_output
if errorlevel 1 goto :failed

if /I "%BUILD_MODE%"=="installer" goto :installer_only

if /I "%BUILD_MODE%"=="fast" goto :fast_build

rem ============================================================
rem FULL OR CLEAN BUILD
rem ============================================================

call :models
if errorlevel 1 goto :failed

call :backend
if errorlevel 1 goto :failed

call :asio
if errorlevel 1 goto :failed

call :package_models
if errorlevel 1 goto :failed

goto :build_electron


rem ============================================================
rem FAST BUILD
rem ============================================================

:fast_build
echo.
echo [FAST] Reusing the existing packaged backend...

call :verify_backend_dist
if errorlevel 1 (
    echo.
    echo [ERROR] Fast build cannot continue because the packaged backend
    echo is missing or incomplete.
    echo.
    echo Run a full build first:
    echo   build-installer.bat
    echo.
    goto :failed
)

goto :build_electron


rem ============================================================
rem ELECTRON BUILD
rem ============================================================

:build_electron
call :electron
if errorlevel 1 goto :failed

goto :build_installer


rem ============================================================
rem INSTALLER-ONLY BUILD
rem ============================================================

:installer_only
echo.
echo [INSTALLER] Reusing the existing Electron win-unpacked directory...

call :verify_unpacked
if errorlevel 1 (
    echo.
    echo [ERROR] Installer-only mode cannot continue because win-unpacked
    echo is missing or incomplete.
    echo.
    echo Run one of these commands first:
    echo   build-installer.bat
    echo   build-installer.bat fast
    echo.
    goto :failed
)


rem ============================================================
rem INSTALLER AND CHECKSUMS
rem ============================================================

:build_installer
call :installer
if errorlevel 1 goto :failed

call :checksums
if errorlevel 1 goto :failed

call :remove_directory "%TEMP_DIR%"

echo.
echo ============================================================
echo  BUILD COMPLETED SUCCESSFULLY
echo ============================================================
echo.
echo Complete offline installer:
echo   %INSTALLER_DIR%
echo.
echo Main installer:
echo   !INSTALLER_EXE!
echo.
echo IMPORTANT:
echo   Keep the Setup.exe and every Setup-*.bin file together.
echo.
echo SHA-256 checksums:
echo   %CHECKSUM_FILE%
echo.

start "" explorer.exe "%INSTALLER_DIR%"

exit /b 0


rem ============================================================
rem STOP PROCESSES THAT CAN LOCK BUILD FILES
rem ============================================================

:stop_build_processes
echo.
echo [0/6] Closing old A^&D Voice build processes...

rem Close only this product's named binaries. Generic electron.exe, node.exe,
rem ffmpeg.exe and build tools may belong to unrelated applications and must
rem never be terminated globally.
taskkill /F /T /IM "%APP_EXE%" >nul 2>&1
taskkill /F /T /IM KaraokeBackend.exe >nul 2>&1
taskkill /F /T /IM KaraokeAudioMonitor.exe >nul 2>&1
taskkill /F /T /IM KaraokeAsioBridge.exe >nul 2>&1

rem Close any executable that is physically running from the old release tree.
if exist "%RELEASE%\" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "$release = [IO.Path]::GetFullPath($env:KARAOKE_RELEASE);" ^
        "Get-Process -ErrorAction SilentlyContinue | ForEach-Object {" ^
        "  try {" ^
        "    $path = $_.Path;" ^
        "    if ($path) {" ^
        "      $full = [IO.Path]::GetFullPath($path);" ^
        "      if ($full.StartsWith($release, [StringComparison]::OrdinalIgnoreCase)) {" ^
        "        Write-Host ('  Closing PID ' + $_.Id + ': ' + $_.ProcessName);" ^
        "        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue;" ^
        "      }" ^
        "    }" ^
        "  } catch {}" ^
        "}"
)

rem Also close helper processes whose command line explicitly references release.
if exist "%RELEASE%\" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "$release = [IO.Path]::GetFullPath($env:KARAOKE_RELEASE);" ^
        "$self = $PID;" ^
        "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {" ^
        "  if ($_.ProcessId -ne $self -and $_.CommandLine -and $_.CommandLine.IndexOf($release, [StringComparison]::OrdinalIgnoreCase) -ge 0) {" ^
        "    try {" ^
        "      Write-Host ('  Closing PID ' + $_.ProcessId + ': ' + $_.Name);" ^
        "      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue;" ^
        "    } catch {}" ^
        "  }" ^
        "}"
)

rem Windows sometimes keeps app.asar/DLL handles alive briefly after termination.
timeout /t 3 /nobreak >nul

exit /b 0

rem ============================================================
rem PREPARE OUTPUT FOR SELECTED MODE
rem ============================================================

:prepare_output
echo.
echo [0/6] Preparing build output...

if /I "%BUILD_MODE%"=="installer" (
    call :remove_directory "%INSTALLER_DIR%"
    if errorlevel 1 exit /b 1

    call :remove_directory "%TEMP_DIR%"
    if errorlevel 1 exit /b 1

    exit /b 0
)

if /I "%BUILD_MODE%"=="fast" (
    call :remove_directory "%UNPACKED%"
    if errorlevel 1 exit /b 1

    call :remove_directory "%INSTALLER_DIR%"
    if errorlevel 1 exit /b 1

    call :remove_directory "%TEMP_DIR%"
    if errorlevel 1 exit /b 1

    exit /b 0
)

rem Full mode rebuilds distributables but keeps reusable downloads.
call :remove_directory "%RELEASE%"
if errorlevel 1 exit /b 1

call :remove_directory "%BUILD%\backend\dist"
if errorlevel 1 exit /b 1

if /I "%BUILD_MODE%"=="clean" (
    echo Cleaning PyInstaller work directories and cache...

    call :remove_directory "%BUILD%"
    if errorlevel 1 exit /b 1

    call :remove_directory "%LOCALAPPDATA%\pyinstaller"
    if errorlevel 1 exit /b 1
)

exit /b 0


rem ============================================================
rem CHECK ENVIRONMENT
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
    echo Add the FFmpeg bin directory to PATH.
    exit /b 1
)

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
rem BUILD PYTHON BACKEND
rem ============================================================

:backend
echo.
echo [2/6] Building Python executables...

"%PYTHON%" -m PyInstaller --version >nul 2>&1

if errorlevel 1 (
    echo PyInstaller is not installed. Installing...

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
echo.
echo [3/6] Building native ASIO bridge...

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

"%CMAKE%" --build "%ASIO_BUILD%"

if errorlevel 1 (
    echo.
    echo [ERROR] ASIO compilation failed.
    exit /b 1
)

call :require_file "%ASIO_BUILD%\KaraokeAsioBridge.exe" "Compiled KaraokeAsioBridge.exe"
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
rem COPY OFFLINE MODELS
rem ============================================================

:package_models
echo.
echo [4/6] Adding only production AI resources...

call :require_directory "%BACKEND_DIST%\_internal" "PyInstaller internal directory"
if errorlevel 1 exit /b 1

call :copy_directory "%MODELS%\qwen\Qwen3-ASR-0.6B" "%BACKEND_DIST%\_internal\models\qwen\Qwen3-ASR-0.6B" "Qwen ASR model"
if errorlevel 1 exit /b 1

call :copy_directory "%MODELS%\qwen\Qwen3-ForcedAligner-0.6B" "%BACKEND_DIST%\_internal\models\qwen\Qwen3-ForcedAligner-0.6B" "Qwen forced aligner"
if errorlevel 1 exit /b 1

call :copy_directory "%MODELS%\roformer" "%BACKEND_DIST%\_internal\models\roformer" "Mel-Band RoFormer model"
if errorlevel 1 exit /b 1

call :copy_directory "%MSST_ENGINE%" "%BACKEND_DIST%\_internal\engines\msst" "MSST inference engine"
if errorlevel 1 exit /b 1

call :verify_backend_dist
if errorlevel 1 exit /b 1

exit /b 0


rem ============================================================
rem VERIFY PACKAGED BACKEND
rem ============================================================

:verify_backend_dist
call :require_file "%BACKEND_DIST%\KaraokeBackend.exe" "KaraokeBackend.exe"
if errorlevel 1 exit /b 1

call :require_file "%BACKEND_DIST%\KaraokeAudioMonitor.exe" "KaraokeAudioMonitor.exe"
if errorlevel 1 exit /b 1

call :require_file "%BACKEND_DIST%\KaraokeAsioBridge.exe" "KaraokeAsioBridge.exe"
if errorlevel 1 exit /b 1

call :require_directory "%BACKEND_DIST%\_internal\models\qwen\Qwen3-ASR-0.6B" "Packaged Qwen ASR model"
if errorlevel 1 exit /b 1

call :require_directory "%BACKEND_DIST%\_internal\models\qwen\Qwen3-ForcedAligner-0.6B" "Packaged Qwen aligner"
if errorlevel 1 exit /b 1

call :require_file "%BACKEND_DIST%\_internal\models\roformer\MelBandRoformer.ckpt" "Packaged RoFormer checkpoint"
if errorlevel 1 exit /b 1

call :require_file "%BACKEND_DIST%\_internal\engines\msst\inference.py" "Packaged MSST engine"
if errorlevel 1 exit /b 1

exit /b 0


rem ============================================================
rem BUILD ELECTRON WIN-UNPACKED
rem ============================================================

:electron
echo.
echo [5/6] Building the complete Electron application...

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
echo Building React frontend...
echo.

call npm run build

if errorlevel 1 (
    popd
    echo.
    echo [ERROR] React frontend build failed.
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
call :require_file "%UNPACKED%\%APP_EXE%" "Electron application"
if errorlevel 1 exit /b 1

call :require_file "%PACKAGED_SCENE_VIDEO%" "Karaoke scene video"
if errorlevel 1 exit /b 1

call :require_file "%PACKAGED_BACKEND%\KaraokeBackend.exe" "Electron backend"
if errorlevel 1 exit /b 1

call :require_file "%PACKAGED_BACKEND%\KaraokeAudioMonitor.exe" "Electron audio monitor"
if errorlevel 1 exit /b 1

call :require_file "%PACKAGED_BACKEND%\KaraokeAsioBridge.exe" "Electron ASIO bridge"
if errorlevel 1 exit /b 1

call :require_directory "%PACKAGED_BACKEND%\_internal\models\qwen\Qwen3-ASR-0.6B" "Electron ASR model"
if errorlevel 1 exit /b 1

call :require_file "%PACKAGED_BACKEND%\_internal\models\roformer\MelBandRoformer.ckpt" "Electron RoFormer model"
if errorlevel 1 exit /b 1

exit /b 0


rem ============================================================
rem BUILD INNO SETUP INSTALLER
rem ============================================================

:installer
echo.
echo [6/6] Building the complete offline installer...

call :find_inno

if not defined INNO_COMPILER (
    echo.
    echo [ERROR] Inno Setup compiler was not found.
    echo.
    echo Install Inno Setup 6 from:
    echo   https://jrsoftware.org/isdl.php
    echo.
    echo Install Inno Setup 6 into its default location.
    echo.
    echo Your already built files were NOT deleted.
    echo After installing Inno Setup, run:
    echo   build-installer.bat installer
    echo.
    exit /b 1
)

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

powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\generate-checksums.ps1" ^
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
rem HELPERS
rem ============================================================

:copy_directory
call :require_directory "%~1" "%~3"
if errorlevel 1 exit /b 1

robocopy "%~1" "%~2" /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /MT:8 /NFL /NDL /NJH /NJS
set "ROBOCOPY_CODE=!ERRORLEVEL!"
if !ROBOCOPY_CODE! GEQ 8 (
    echo.
    echo [ERROR] Failed to copy %~3.
    echo Robocopy exit code: !ROBOCOPY_CODE!
    exit /b 1
)
exit /b 0

:sign_file
powershell -NoProfile -ExecutionPolicy Bypass -File "%SIGN_SCRIPT%" -Path "%~1"
if errorlevel 1 (
    echo.
    echo [ERROR] Code signing failed for:
    echo   %~1
    exit /b 1
)
exit /b 0

:require_file
if exist "%~1" (
    exit /b 0
)

echo.
echo [ERROR] %~2 was not found:
echo   %~1

exit /b 1


:require_directory
if exist "%~1\" (
    exit /b 0
)

echo.
echo [ERROR] %~2 was not found:
echo   %~1

exit /b 1


:remove_directory
set "REMOVE_TARGET=%~1"

if not exist "%REMOVE_TARGET%\" (
    exit /b 0
)

echo Removing:
echo   %REMOVE_TARGET%

rem Retry because Windows can release app.asar and DLL handles asynchronously.
for /L %%I in (1,1,10) do (
    rmdir /S /Q "%REMOVE_TARGET%" >nul 2>&1

    if not exist "%REMOVE_TARGET%\" (
        exit /b 0
    )

    echo   Directory is still locked. Retry %%I/10...

    rem If this is the Electron release tree, stop old app processes again.
    if /I "%REMOVE_TARGET%"=="%RELEASE%" (
        taskkill /F /T /IM "%APP_EXE%" >nul 2>&1
        taskkill /F /T /IM KaraokeBackend.exe >nul 2>&1
        taskkill /F /T /IM KaraokeAudioMonitor.exe >nul 2>&1
        taskkill /F /T /IM KaraokeAsioBridge.exe >nul 2>&1

        powershell -NoProfile -ExecutionPolicy Bypass -Command ^
            "$release = [IO.Path]::GetFullPath($env:KARAOKE_RELEASE);" ^
            "Get-Process -ErrorAction SilentlyContinue | ForEach-Object {" ^
            "  try {" ^
            "    $path = $_.Path;" ^
            "    if ($path -and [IO.Path]::GetFullPath($path).StartsWith($release, [StringComparison]::OrdinalIgnoreCase)) {" ^
            "      Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue;" ^
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
echo To find the exact process locking app.asar:
echo   1. Press Win+R
echo   2. Run: resmon
echo   3. Open CPU ^> Associated Handles
echo   4. Search for: app.asar
echo.
exit /b 1

:find_inno
set "INNO_COMPILER="

rem Optional explicit override before running this script:
rem set INNO_COMPILER_OVERRIDE=C:\Custom\Inno Setup 6\ISCC.exe

if defined INNO_COMPILER_OVERRIDE (
    call :try_inno_path "%INNO_COMPILER_OVERRIDE%"
)

if defined INNO_COMPILER exit /b 0

set "INNO_PF86=%ProgramFiles(x86)%"
set "INNO_PF=%ProgramFiles%"

call :try_inno_path "%INNO_PF86%\Inno Setup 6\ISCC.exe"
if defined INNO_COMPILER exit /b 0

call :try_inno_path "%INNO_PF%\Inno Setup 6\ISCC.exe"
if defined INNO_COMPILER exit /b 0

call :try_inno_path "%INNO_PF86%\Inno Setup 7\ISCC.exe"
if defined INNO_COMPILER exit /b 0

call :try_inno_path "%INNO_PF%\Inno Setup 7\ISCC.exe"
if defined INNO_COMPILER exit /b 0

for /f "tokens=2,*" %%A in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1" /v InstallLocation 2^>nul') do (
    call :try_inno_path "%%~B\ISCC.exe"
)

if defined INNO_COMPILER exit /b 0

for /f "tokens=2,*" %%A in ('reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1" /v InstallLocation 2^>nul') do (
    call :try_inno_path "%%~B\ISCC.exe"
)

exit /b 0


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
