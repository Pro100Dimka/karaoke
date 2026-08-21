@echo off
setlocal EnableExtensions

echo.
echo ============================================================
echo  A^&D Voice - Build bootstrap
echo ============================================================
echo.
echo Restoring Git-ignored development/build resources...
set "KARAOKE_PREPARE_DIRECTML=1"
call "%~dp0start-dev.bat" --prepare-only
if errorlevel 1 (
    echo [ERROR] Build dependency preparation failed.
    exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-installer.ps1" %*
exit /b %errorlevel%
