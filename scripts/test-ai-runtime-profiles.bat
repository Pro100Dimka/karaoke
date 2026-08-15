@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "PY=%ROOT%\backend\venv\Scripts\python.exe"

echo.
echo ============================================================
echo  A^&D Voice - AI Runtime Profile Matrix
echo ============================================================
echo.

if not exist "%PY%" (
    echo [ERROR] Backend virtual environment was not found:
    echo   %PY%
    echo Run start-dev.bat once first.
    exit /b 1
)

set "PYTHONPATH=%ROOT%\backend"
"%PY%" "%ROOT%\scripts\ai_runtime_benchmark\runtime_profile_matrix.py"
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
    echo [OK] Runtime selector matrix passed.
) else (
    echo [ERROR] Runtime selector matrix failed.
)
exit /b %RC%
