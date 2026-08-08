@echo off
setlocal
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "PYTHON=%ROOT%\backend\venv\Scripts\python.exe"

if not exist "%PYTHON%" (
  echo Backend virtual environment was not found: %PYTHON%
  exit /b 1
)

echo [1/2] Verifying frontend, architecture and UI...
call npm --prefix "%ROOT%\front" run verify || exit /b 1
call npm --prefix "%ROOT%\front" run verify:ui || exit /b 1

echo [2/2] Verifying backend and AI pipeline...
pushd "%ROOT%\backend"
"%PYTHON%" -m ruff check app AI tests || exit /b 1
"%PYTHON%" -m ruff format --check app AI tests || exit /b 1
"%PYTHON%" -m mypy app || exit /b 1
"%PYTHON%" -m pytest -q || exit /b 1
"%PYTHON%" -m pip check || exit /b 1
rem qwen-asr 0.0.6 requires transformers 4.57.6 exactly. The application only
rem loads bundled offline models, so the model-deserialization advisories below
rem are not reachable from user input. Keep this explicit until qwen-asr updates.
"%PYTHON%" -m pip_audit ^
  --ignore-vuln PYSEC-2025-217 ^
  --ignore-vuln PYSEC-2026-2288 ^
  --ignore-vuln PYSEC-2026-2289 ^
  --ignore-vuln PYSEC-2026-2290 || exit /b 1
popd

echo.
echo All checks passed.
