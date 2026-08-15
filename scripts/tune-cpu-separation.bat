@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "BACK=%ROOT%\backend"
set "PY=%BACK%\venv\Scripts\python.exe"
set "ENV=%ROOT%\downloads\ai-environment.bat"

if "%~1"=="" (
    echo Usage:
    echo   scripts\tune-cpu-separation.bat "C:\path\song.mp3" [seconds] [threads]
    echo.
    echo Example:
    echo   scripts\tune-cpu-separation.bat "D:\Music\song.mp3" 8
    echo   scripts\tune-cpu-separation.bat "D:\Music\song.mp3" 8 8,12,16,20
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
if not defined SECONDS set "SECONDS=8"
set "CANDIDATES=%~3"

set "OLD_PYTHONPATH=%PYTHONPATH%"
set "PYTHONPATH=%BACK%;%ROOT%\scripts;%PYTHONPATH%"
if defined CANDIDATES (
    "%PY%" "%ROOT%\scripts\tune_cpu_separation.py" "%~1" --seconds "%SECONDS%" --threads "%CANDIDATES%"
) else (
    "%PY%" "%ROOT%\scripts\tune_cpu_separation.py" "%~1" --seconds "%SECONDS%"
)
set "RC=%ERRORLEVEL%"
set "PYTHONPATH=%OLD_PYTHONPATH%"
exit /b %RC%
