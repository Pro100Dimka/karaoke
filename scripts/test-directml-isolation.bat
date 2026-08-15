@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "PY=%ROOT%\backend\venv\Scripts\python.exe"
set "DML=%ROOT%\downloads\runtimes\onnxruntime-directml"
set "BEFORE=%TEMP%\advoice-directml-before-%RANDOM%.json"
set "AFTER=%TEMP%\advoice-directml-after-%RANDOM%.json"

echo.
echo ============================================================
echo  A^&D Voice - DirectML Isolation Test
echo ============================================================
echo.

if not exist "%PY%" (
    echo [ERROR] Backend virtual environment was not found.
    exit /b 1
)

"%PY%" "%ROOT%\scripts\ai_runtime_benchmark\environment_fingerprint.py" --output "%BEFORE%"
if errorlevel 1 goto :fail

pushd "%ROOT%\scripts" >nul || goto :fail
call prepare-fcpe-directml-pilot.bat
set "PREP_RC=%ERRORLEVEL%"
popd
if not "%PREP_RC%"=="0" goto :fail

"%PY%" "%ROOT%\scripts\ai_runtime_benchmark\environment_fingerprint.py" --output "%AFTER%"
if errorlevel 1 goto :fail

fc /b "%BEFORE%" "%AFTER%" >nul
if errorlevel 1 (
    echo [ERROR] backend\venv package versions changed during DirectML preparation.
    echo Before:
    type "%BEFORE%"
    echo After:
    type "%AFTER%"
    goto :fail
)

for %%P in (numpy scipy tensorflow protobuf ml_dtypes) do (
    if exist "%DML%\%%P" (
        echo [ERROR] Optional DirectML runtime contains forbidden dependency: %%P
        goto :fail
    )
)

set "OLD_PYTHONPATH=%PYTHONPATH%"
set "PYTHONPATH=%DML%;%ROOT%\backend;%PYTHONPATH%"
"%PY%" -c "import numpy,onnxruntime as o; print('NumPy:',numpy.__version__,'from',numpy.__file__); print('ORT:',o.__version__,'from',o.__file__); print('Providers:',o.get_available_providers()); raise SystemExit(0 if 'DmlExecutionProvider' in o.get_available_providers() else 1)"
set "RC=%ERRORLEVEL%"
set "PYTHONPATH=%OLD_PYTHONPATH%"
if not "%RC%"=="0" goto :fail

echo.
echo [PASS] DirectML runtime is isolated and backend\venv is unchanged.
del /q "%BEFORE%" "%AFTER%" >nul 2>&1
exit /b 0

:fail
set "RC=%ERRORLEVEL%"
if "%RC%"=="0" set "RC=1"
del /q "%BEFORE%" "%AFTER%" >nul 2>&1
exit /b %RC%
