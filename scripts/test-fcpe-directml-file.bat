@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "PY=%ROOT%\backend\venv\Scripts\python.exe"
set "ENV=%ROOT%\downloads\ai-environment.bat"

if "%~1"=="" (
  echo Usage:
  echo   scripts\test-fcpe-directml-file.bat "D:\path\to\vocals.wav"
  exit /b 2
)
if not exist "%PY%" (
  echo [ERROR] Backend virtual environment was not found. Run start-dev.bat once first.
  exit /b 1
)

pushd "%ROOT%\scripts" >nul || exit /b 1
call test-directml-isolation.bat
set "PREP_RC=%ERRORLEVEL%"
popd
if not "%PREP_RC%"=="0" exit /b %PREP_RC%
if exist "%ENV%" call "%ENV%" >nul 2>&1

set "PYTHONPATH=%KARAOKE_AI_ORT_DIRECTML_PATH%;%ROOT%\backend"
"%PY%" "%ROOT%\scripts\ai_runtime_benchmark\directml_fcpe_file_gate.py" "%~1" --json-output "%ROOT%\logs\directml-fcpe-file-gate.json"
exit /b %ERRORLEVEL%
