@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"

set "THREADS=%~1"
if not defined THREADS set "THREADS=auto"

echo.
echo ============================================================
echo  A^&D Voice - Development - Tuned CPU Test
echo ============================================================
echo.
echo This is an A/B performance pilot for the existing CPU algorithms.
echo No AI model, chunk/overlap setting or quality algorithm is changed.
echo.
echo CPU intra-op threads: %THREADS%
echo CPU inter-op threads: 1
echo Separation inference_mode: ON
echo.
echo Compare the SAME song against scripts\start-dev-cpu.bat.
echo You can also try another thread count, for example:
echo   scripts\start-dev-cpu-tuned.bat 10
echo.

set "KARAOKE_AI_RUNTIME_OVERRIDE=cpu"
set "SONGAPP_DEVICE=cpu"
set "KARAOKE_CPU_TUNING=1"
set "KARAOKE_CPU_INTRAOP_THREADS=%THREADS%"
set "KARAOKE_CPU_INTEROP_THREADS=1"
set "KARAOKE_CPU_INFERENCE_MODE=1"
call "%ROOT%\start-dev.bat"
exit /b %ERRORLEVEL%
