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
set "ONNXTOOLS=%DL%\runtimes\onnx-export-tools"
set "ORT_VER=1.22.0"
set "ONNX_VER=1.18.0"

echo.
echo ============================================================
echo  A^&D Voice - FCPE DirectML Pilot Preparation
echo ============================================================
echo.
echo DirectML is an optional isolated runtime.
echo The backend virtual environment is not modified.
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
if not exist "%ONNXTOOLS%\" mkdir "%ONNXTOOLS%" >nul 2>&1 || exit /b 1

echo [1/5] DirectML runtime isolation...
set "REBUILD_DML=0"
for %%P in (numpy scipy tensorflow protobuf ml_dtypes) do if exist "%DML%\%%P" set "REBUILD_DML=1"
if "%REBUILD_DML%"=="0" (
    set "OLD_PYTHONPATH=%PYTHONPATH%"
    set "PYTHONPATH=%DML%;%BACK%;%PYTHONPATH%"
    "%PY%" -c "import onnxruntime as o; raise SystemExit(0 if o.__version__=='%ORT_VER%' and 'DmlExecutionProvider' in o.get_available_providers() else 1)" >nul 2>&1
    if errorlevel 1 set "REBUILD_DML=1"
    set "PYTHONPATH=%OLD_PYTHONPATH%"
)
if "%REBUILD_DML%"=="1" (
    echo       rebuilding clean onnxruntime-directml %ORT_VER% runtime...
    if exist "%DML%\" rmdir /s /q "%DML%"
    mkdir "%DML%" >nul 2>&1 || goto :fail
    "%PY%" -m pip install --quiet --disable-pip-version-check --no-input --target "%DML%" --no-deps "onnxruntime-directml==%ORT_VER%"
    if errorlevel 1 goto :fail
) else (
    echo       clean runtime already prepared.
)
for %%P in (numpy scipy tensorflow protobuf ml_dtypes) do (
    if exist "%DML%\%%P" (
        echo [ERROR] DirectML runtime is not isolated: %%P exists in %DML%
        goto :fail
    )
)

echo [2/5] ONNX export tool isolation...
set "REBUILD_ONNX=0"
for %%P in (numpy scipy tensorflow protobuf ml_dtypes) do if exist "%ONNXTOOLS%\%%P" set "REBUILD_ONNX=1"
set "OLD_PYTHONPATH=%PYTHONPATH%"
set "PYTHONPATH=%ONNXTOOLS%;%BACK%;%PYTHONPATH%"
"%PY%" -c "import onnx; raise SystemExit(0 if onnx.__version__=='%ONNX_VER%' else 1)" >nul 2>&1
if errorlevel 1 set "REBUILD_ONNX=1"
set "PYTHONPATH=%OLD_PYTHONPATH%"
if "%REBUILD_ONNX%"=="1" (
    echo       rebuilding clean onnx %ONNX_VER% export tool...
    if exist "%ONNXTOOLS%\" rmdir /s /q "%ONNXTOOLS%"
    mkdir "%ONNXTOOLS%" >nul 2>&1 || goto :fail
    "%PY%" -m pip install --quiet --disable-pip-version-check --no-input --target "%ONNXTOOLS%" --no-deps "onnx==%ONNX_VER%"
    if errorlevel 1 goto :fail
) else (
    echo       export tool already prepared.
)

echo [3/5] Exporting FCPE neural core...
set "OLD_PYTHONPATH=%PYTHONPATH%"
set "PYTHONPATH=%ONNXTOOLS%;%BACK%;%PYTHONPATH%"
"%PY%" "%ROOT%\scripts\ai_runtime_benchmark\export_models.py" --models fcpe --output "%OUT%"
set "RC=%ERRORLEVEL%"
set "PYTHONPATH=%OLD_PYTHONPATH%"
if not "%RC%"=="0" goto :fail
if not exist "%OUT%\fcpe-core.onnx" (
    echo [ERROR] FCPE ONNX export was not created.
    goto :fail
)

echo [4/5] Verifying DirectML without dependency shadowing...
set "OLD_PYTHONPATH=%PYTHONPATH%"
set "PYTHONPATH=%DML%;%BACK%;%PYTHONPATH%"
"%PY%" -c "import numpy,onnxruntime as o; p=o.get_available_providers(); print('NumPy:',numpy.__version__,'from',numpy.__file__); print('ORT:',o.__version__,'from',o.__file__); print('Providers:', ', '.join(p)); raise SystemExit(0 if 'DmlExecutionProvider' in p else 1)"
set "RC=%ERRORLEVEL%"
set "PYTHONPATH=%OLD_PYTHONPATH%"
if not "%RC%"=="0" (
    echo [ERROR] DmlExecutionProvider is unavailable on this PC/runtime.
    goto :fail
)

echo [5/5] Refreshing AI environment...
set "OLD_PYTHONPATH=%PYTHONPATH%"
set "PYTHONPATH=%BACK%;%PYTHONPATH%"
"%PY%" -m AI.install_models --downloads "%DL%" --msst "%MSST%" --env "%ENV%" --quick-check
set "RC=%ERRORLEVEL%"
set "PYTHONPATH=%OLD_PYTHONPATH%"
if not "%RC%"=="0" goto :fail

echo.
echo [OK] DirectML FCPE pilot is prepared in shadow-only mode.
echo      backend\venv was not modified.
echo      artifact: %OUT%\fcpe-core.onnx
echo      runtime : %DML%
echo.
exit /b 0

:fail
echo.
echo [ERROR] DirectML FCPE pilot preparation failed.
exit /b 1
