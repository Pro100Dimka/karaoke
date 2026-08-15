@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "BACK=%ROOT%\backend"
set "PY=%BACK%\venv\Scripts\python.exe"
set "ENV=%ROOT%\downloads\ai-environment.bat"

if "%~1"=="" (
    echo Usage:
    echo   scripts\benchmark-cpu-separation.bat "C:\path\song.mp3" [seconds] [threads]
    echo.
    echo Example:
    echo   scripts\benchmark-cpu-separation.bat "D:\Music\song.mp3" 20 auto
    echo   scripts\benchmark-cpu-separation.bat "D:\Music\song.mp3" 20 10
    exit /b 2
)
if not exist "%PY%" (
    echo [ERROR] Backend venv Python not found: %PY%
    exit /b 1
)
if not exist "%ENV%" (
    echo [ERROR] AI environment not found: %ENV%
    exit /b 1
)
call "%ENV%"

set "SECONDS=%~2"
if not defined SECONDS set "SECONDS=20"
set "THREADS=%~3"
if not defined THREADS set "THREADS=auto"

set "OLD_PYTHONPATH=%PYTHONPATH%"
set "PYTHONPATH=%BACK%;%PYTHONPATH%"
"%PY%" "%ROOT%\scripts\benchmark_cpu_separation.py" "%~1" --seconds "%SECONDS%" --threads "%THREADS%"
set "RC=%ERRORLEVEL%"
set "PYTHONPATH=%OLD_PYTHONPATH%"
exit /b %RC%
