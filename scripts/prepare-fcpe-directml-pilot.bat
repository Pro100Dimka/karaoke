@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "BACK=%ROOT%\backend"
set "PY=%BACK%\venv\Scripts\python.exe"
set "DL=%ROOT%\downloads"
set "MSST=%DL%\engines\msst"
set "ENV=%DL%\ai-environment.bat"
set "OUT=%DL%\models\optimized\fcpe"
set "DML=%DL%\runtimes\onnxruntime-directml"

echo.
echo ============================================================
echo  A^&D Voice - FCPE DirectML Pilot Preparation
echo ============================================================
echo.

if not exist "%PY%" (
    echo [ERROR] Backend virtual environment was not found:
    echo   %PY%
    echo Run start-dev.bat once first.
    exit /b 1
)

if /i not "%PROCESSOR_ARCHITECTURE%"=="AMD64" if /i not "%PROCESSOR_ARCHITEW6432%"=="AMD64" (
    echo [ERROR] This pilot currently expects 64-bit Windows.
    exit /b 1
)

if not exist "%OUT%\" mkdir "%OUT%" >nul 2>&1 || exit /b 1
if not exist "%DML%\" mkdir "%DML%" >nul 2>&1 || exit /b 1

echo [1/4] DirectML pilot runtime...
"%PY%" -m pip install --quiet --disable-pip-version-check --no-input --upgrade --target "%DML%" "onnx>=1.16,<2" "onnxruntime-directml>=1.22,<2"
if errorlevel 1 goto :fail

echo [2/4] Exporting FCPE neural core...
set "OLD_PYTHONPATH=%PYTHONPATH%"
set "PYTHONPATH=%DML%;%BACK%;%PYTHONPATH%"
"%PY%" "%ROOT%\scripts\ai_runtime_benchmark\export_models.py" --models fcpe --output "%OUT%"
set "RC=%ERRORLEVEL%"
set "PYTHONPATH=%OLD_PYTHONPATH%"
if not "%RC%"=="0" goto :fail

if not exist "%OUT%\fcpe-core.onnx" (
    echo [ERROR] FCPE ONNX export was not created.
    goto :fail
)

echo [3/4] Verifying DirectML provider...
set "OLD_PYTHONPATH=%PYTHONPATH%"
set "PYTHONPATH=%DML%;%PYTHONPATH%"
"%PY%" -c "import onnxruntime as o; p=o.get_available_providers(); print('Providers:', ', '.join(p)); raise SystemExit(0 if 'DmlExecutionProvider' in p else 1)"
set "PYTHONPATH=%OLD_PYTHONPATH%"
if errorlevel 1 (
    echo [ERROR] DmlExecutionProvider is unavailable on this PC/runtime.
    goto :fail
)

echo [4/4] Refreshing AI environment...
set "OLD_PYTHONPATH=%PYTHONPATH%"
set "PYTHONPATH=%BACK%;%PYTHONPATH%"
"%PY%" -m AI.install_models --downloads "%DL%" --msst "%MSST%" --env "%ENV%" --quick-check
set "RC=%ERRORLEVEL%"
set "PYTHONPATH=%OLD_PYTHONPATH%"
if not "%RC%"=="0" goto :fail

echo.
echo DirectML FCPE pilot is prepared in shadow-only mode.
echo Artifact:
echo   %OUT%\fcpe-core.onnx
echo.
echo To validate it, start the app with:
echo   set KARAOKE_AI_FCPE_SHADOW=1
echo   set KARAOKE_AI_FCPE_SHADOW_BACKEND=directml
echo   start-dev.bat
echo.
exit /b 0

:fail
echo.
echo [ERROR] DirectML FCPE pilot preparation failed.
exit /b 1
