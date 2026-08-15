@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"

echo.
echo ============================================================
echo  A^&D Voice - Development - CPU Baseline
echo ============================================================
echo.
echo This reproduces the original forced-CPU path WITHOUT CPU tuning.
echo Use it only for before/after comparison.
echo.

set "KARAOKE_AI_RUNTIME_OVERRIDE=cpu"
set "SONGAPP_DEVICE=cpu"
set "KARAOKE_CPU_TUNING="
set "KARAOKE_CPU_INTRAOP_THREADS="
set "KARAOKE_CPU_INTEROP_THREADS="
set "KARAOKE_CPU_INFERENCE_MODE="
call "%ROOT%\start-dev.bat"
exit /b %ERRORLEVEL%
