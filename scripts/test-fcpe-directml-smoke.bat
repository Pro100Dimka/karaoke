@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "PY=%ROOT%\backend\venv\Scripts\python.exe"
set "ENV=%ROOT%\downloads\ai-environment.bat"

echo.
echo ============================================================
echo  A^&D Voice - FCPE DirectML Real Smoke Test
echo ============================================================
echo.
echo This runs DirectML on the GPU physically installed in this PC.
echo On an RTX it validates DirectML compatibility, NOT AMD/Intel speed.
echo.

if not exist "%PY%" (
    echo [ERROR] Backend virtual environment was not found.
    echo Run start-dev.bat once first.
    exit /b 1
)

pushd "%ROOT%\scripts" >nul || exit /b 1
call test-directml-isolation.bat
set "PREP_RC=%ERRORLEVEL%"
popd
if not "%PREP_RC%"=="0" exit /b %PREP_RC%

if not exist "%ENV%" (
    echo [ERROR] AI environment was not generated:
    echo   %ENV%
    exit /b 1
)

call "%ENV%"
if errorlevel 1 exit /b 1

set "PYTHONPATH=%KARAOKE_AI_ORT_DIRECTML_PATH%;%ROOT%\backend"
"%PY%" "%ROOT%\scripts\ai_runtime_benchmark\directml_fcpe_smoke.py"
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
    echo [OK] DirectML FCPE real smoke passed.
) else (
    echo [ERROR] DirectML FCPE real smoke failed.
)
exit /b %RC%
