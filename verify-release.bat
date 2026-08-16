@echo off
setlocal EnableExtensions
for %%I in ("%~dp0.") do set "ROOT=%%~fI"
set "PY=%ROOT%\backend\venv\Scripts\python.exe"
if not exist "%PY%" (
  echo [RELEASE BLOCKED] Backend virtual environment is missing: %PY%
  echo Run start-dev.bat --prepare-only first.
  exit /b 1
)
"%PY%" "%ROOT%\scripts\release_gate.py"
exit /b %errorlevel%
