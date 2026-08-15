@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"

set "THREADS=%~1"
if not defined THREADS set "THREADS=auto"

echo.
echo ============================================================
echo  A^&D Voice - Development - Optimized CPU Test
echo ============================================================
echo.
echo This run forces every production AI stage to CPU and enables the
echo safe PyTorch CPU inference tuning used by the current benchmark pilot.
echo.
echo CPU intra-op threads: %THREADS%
echo CPU inter-op threads: 1
echo Separation inference_mode: ON
echo.
echo To reproduce the old untuned CPU baseline use:
echo   scripts\start-dev-cpu-baseline.bat
echo.
echo For a fast A/B test before processing a full song use:
echo   scripts\benchmark-cpu-separation.bat "C:\path\song.mp3" 30 auto
echo.

set "KARAOKE_AI_RUNTIME_OVERRIDE=cpu"
set "SONGAPP_DEVICE=cpu"
set "KARAOKE_CPU_TUNING=1"
set "KARAOKE_CPU_INTRAOP_THREADS=%THREADS%"
set "KARAOKE_CPU_INTEROP_THREADS=1"
set "KARAOKE_CPU_INFERENCE_MODE=1"
call "%ROOT%\start-dev.bat"
exit /b %ERRORLEVEL%
