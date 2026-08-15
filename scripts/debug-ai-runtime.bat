@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "PY=%ROOT%\backend\venv\Scripts\python.exe"
set "ENV=%ROOT%\downloads\ai-environment.bat"

if not exist "%PY%" (
  echo [ERROR] Backend virtual environment was not found.
  echo Run start-dev.bat once first.
  exit /b 1
)

if exist "%ENV%" call "%ENV%" >nul 2>&1
set "PYTHONPATH=%ROOT%\backend"
"%PY%" "%ROOT%\scripts\ai_runtime_benchmark\runtime_debug.py" %*
exit /b %ERRORLEVEL%
