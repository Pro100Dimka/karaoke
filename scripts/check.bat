@echo off
setlocal
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "PYTHON="

if exist "%ROOT%\backend\venv\Scripts\python.exe" (
  set "PYTHON=%ROOT%\backend\venv\Scripts\python.exe"
)

if not defined PYTHON (
  for /f "delims=" %%P in ('py -3.12 -c "import sys; print(sys.executable)" 2^>nul') do set "PYTHON=%%P"
)
if defined PYTHON if not exist "%PYTHON%" set "PYTHON="

if not defined PYTHON (
  for /f "delims=" %%P in ('py -3.11 -c "import sys; print(sys.executable)" 2^>nul') do set "PYTHON=%%P"
)

if not defined PYTHON (
  echo Python 3.11 or 3.12 was not found.
  exit /b 1
)

echo [1/5] Verifying frontend and architecture...
call npm --prefix "%ROOT%\front" run verify || exit /b 1

echo [2/5] Verifying frontend coverage and mutations...
call npm --prefix "%ROOT%\front" run test:unit:core:coverage || exit /b 1
call npm --prefix "%ROOT%\front" run test:mutation || exit /b 1

echo [3/5] Verifying frontend end-to-end flow...
call npm --prefix "%ROOT%\front" run test:e2e || exit /b 1

echo [4/5] Auditing frontend dependencies...
call npm --prefix "%ROOT%\front" audit || exit /b 1

echo [5/5] Verifying backend and AI pipeline...
pushd "%ROOT%\backend"
"%PYTHON%" -m ruff check app AI config.py database.py models.py schemas.py run.py || exit /b 1
"%PYTHON%" -m ruff format --check app AI config.py database.py models.py schemas.py run.py || exit /b 1
"%PYTHON%" -m mypy app || exit /b 1
"%PYTHON%" "%ROOT%\scripts\backend\audit_semantic_density.py" || exit /b 1
"%PYTHON%" -m pytest -q --cov=app --cov=AI --cov=config --cov=database --cov=models --cov=schemas --cov-report=term || exit /b 1
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
