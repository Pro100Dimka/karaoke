@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"

set "THREADS=%~1"
if not defined THREADS set "THREADS=auto"

echo.
echo ============================================================
echo  A^&D Voice - Development - Tuned CPU Eager Comparison
echo ============================================================
echo.
echo Same CPU tuning as start-dev-cpu.bat, but torch.compile is OFF.
echo.

set "KARAOKE_AI_RUNTIME_OVERRIDE=cpu"
set "SONGAPP_DEVICE=cpu"
set "KARAOKE_CPU_TUNING=1"
set "KARAOKE_CPU_INTRAOP_THREADS=%THREADS%"
set "KARAOKE_CPU_INTEROP_THREADS=1"
set "KARAOKE_CPU_INFERENCE_MODE=1"
set "KARAOKE_CPU_COMPILE="
call "%ROOT%\start-dev.bat"
exit /b %ERRORLEVEL%
