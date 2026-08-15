@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
call "%ROOT%\scripts\prepare-roformer-openvino-cpu-pilot.bat" || exit /b 1
set "KARAOKE_CPU_COMPILE=1"
set "KARAOKE_CPU_COMPILE_BACKEND=openvino"
set "KARAOKE_CPU_COMPILE_DYNAMIC=1"
set "KARAOKE_OPENVINO_CACHE_DIR=%ROOT%\downloads\cache\openvino-roformer"
set "KARAOKE_AI_RUNTIME_OVERRIDE=cpu"
set "SONGAPP_DEVICE=cpu"
set "KARAOKE_CPU_TUNING=1"
set "KARAOKE_CPU_INTEROP_THREADS=1"
set "KARAOKE_CPU_INFERENCE_MODE=1"
set "KARAOKE_LYRICS_VERBOSE="
set "KARAOKE_LYRICS_LOG_TEXT=1"
set "TF_CPP_MIN_LOG_LEVEL=2"
set "THREAD_CACHE=%ROOT%\downloads\cache\ai-runtime\cpu-separation-threads.txt"
if exist "%THREAD_CACHE%" (
  set /p KARAOKE_CPU_INTRAOP_THREADS=<"%THREAD_CACHE%"
) else (
  set "KARAOKE_CPU_INTRAOP_THREADS=auto"
)
echo.
echo ============================================================
echo  A^&D Voice - Development - OpenVINO CPU Pilot
echo ============================================================
echo.
echo This is a pilot. Normal production selection is unchanged.
echo CPU threads: %KARAOKE_CPU_INTRAOP_THREADS%
echo.
call "%ROOT%\start-dev.bat"
exit /b %ERRORLEVEL%
