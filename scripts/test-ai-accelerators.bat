@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"

echo.
echo ============================================================
echo  A^&D Voice - AI Accelerator Debug Suite
echo ============================================================
echo.

echo [1/2] Simulated selector/fallback matrix
call "%ROOT%\scripts\test-ai-runtime-profiles.bat"
if errorlevel 1 exit /b 1

echo.
echo [2/2] Current PC hardware/runtime report
call "%ROOT%\scripts\debug-ai-runtime.bat"
if errorlevel 1 exit /b 1

echo.
echo [OK] Accelerator debug suite passed.
echo.
echo Optional real DirectML tests:
echo   scripts\test-directml-isolation.bat
echo   scripts\test-fcpe-directml-smoke.bat
echo   scripts\test-fcpe-directml-file.bat "D:\path\to\vocals.wav"
exit /b 0
