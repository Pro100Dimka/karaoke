@echo off
setlocal
set "ROOT=%~dp0"
set "PYTHON=%ROOT%backend\venv\Scripts\python.exe"

if not exist "%PYTHON%" (
  echo Backend virtual environment was not found: %PYTHON%
  exit /b 1
)

call npm --prefix "%ROOT%front" run build || exit /b 1
pushd "%ROOT%backend"
"%PYTHON%" -m ruff check app AI || exit /b 1
"%PYTHON%" -m mypy app --ignore-missing-imports || exit /b 1
"%PYTHON%" -m pytest -q || exit /b 1
"%PYTHON%" -m pip check || exit /b 1
popd

echo.
echo All checks passed.
