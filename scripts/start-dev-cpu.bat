@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"

set "THREADS=%~1"
set "THREAD_SOURCE=command line"
if not defined THREADS (
  set "THREAD_CACHE=%ROOT%\downloads\cache\ai-runtime\cpu-separation-threads.txt"
  if exist "%THREAD_CACHE%" (
    set /p THREADS=<"%THREAD_CACHE%"
    set "THREAD_SOURCE=autotune cache"
  ) else (
    set "THREADS=auto"
    set "THREAD_SOURCE=auto/default"
  )
)

set "KARAOKE_AI_RUNTIME_OVERRIDE=cpu"
set "SONGAPP_DEVICE=cpu"
set "KARAOKE_CPU_TUNING=1"
set "KARAOKE_CPU_INTRAOP_THREADS=%THREADS%"
set "KARAOKE_CPU_INTEROP_THREADS=1"
set "KARAOKE_CPU_INFERENCE_MODE=1"
set "KARAOKE_LYRICS_VERBOSE="
set "KARAOKE_LYRICS_LOG_TEXT=1"
set "TF_CPP_MIN_LOG_LEVEL=2"

set "KARAOKE_CPU_COMPILE="
where cl.exe >nul 2>nul
if not errorlevel 1 (
  set "KARAOKE_CPU_COMPILE=1"
  set "KARAOKE_CPU_COMPILE_BACKEND=inductor"
  set "KARAOKE_CPU_COMPILE_MODE=default"
  set "KARAOKE_CPU_COMPILE_DYNAMIC=1"
  set "TORCHINDUCTOR_CACHE_DIR=%ROOT%\downloads\cache\torchinductor-cpu"
)

echo.
echo ============================================================
echo  A^&D Voice - Development - Optimized CPU Test
echo ============================================================
echo.
echo CPU intra-op threads: %THREADS% ^(%THREAD_SOURCE%^)
echo CPU inter-op threads: 1
echo Separation inference_mode: ON
if defined KARAOKE_CPU_COMPILE (
  echo Separation torch.compile: ON ^(MSVC cl.exe detected^)
) else (
  echo Separation torch.compile: OFF ^(MSVC cl.exe not found; using tuned eager^)
)
echo Lyrics log: compact ^(+ temporary found-text output^)
echo CPU autotune: scripts\tune-cpu-separation.bat "C:\path\song.mp3" 8
echo.

call "%ROOT%\start-dev.bat"
exit /b %ERRORLEVEL%
