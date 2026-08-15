@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "BACK=%ROOT%\backend"
set "PY=%BACK%\venv\Scripts\python.exe"
set "ENV=%ROOT%\downloads\ai-environment.bat"

if "%~1"=="" (
  echo Usage:
  echo   scripts\benchmark-cpu-separation-openvino.bat "C:\path\song.mp3" [seconds] [threads]
  exit /b 2
)
if not exist "%PY%" (
  echo [ERROR] Backend venv Python not found: %PY%
  exit /b 1
)
if exist "%ENV%" call "%ENV%"

call "%ROOT%\scripts\prepare-roformer-openvino-cpu-pilot.bat" || exit /b 1
set "SECONDS=%~2"
if not defined SECONDS set "SECONDS=8"
set "THREADS=%~3"
if not defined THREADS (
  set "THREAD_CACHE=%ROOT%\downloads\cache\ai-runtime\cpu-separation-threads.txt"
  if exist "%THREAD_CACHE%" set /p THREADS=<"%THREAD_CACHE%"
)
if not defined THREADS set "THREADS=auto"

set "OLD_PYTHONPATH=%PYTHONPATH%"
set "PYTHONPATH=%BACK%;%PYTHONPATH%"
pushd "%ROOT%"
"%PY%" "%ROOT%\scripts\benchmark_cpu_separation_openvino.py" "%~1" --seconds "%SECONDS%" --threads "%THREADS%"
set "RC=%ERRORLEVEL%"
popd
set "PYTHONPATH=%OLD_PYTHONPATH%"
exit /b %RC%
