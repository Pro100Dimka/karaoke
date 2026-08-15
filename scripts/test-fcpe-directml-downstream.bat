@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "PY=%ROOT%\backend\venv\Scripts\python.exe"
set "ENV=%ROOT%\downloads\ai-environment.bat"
set "RUNTIME=%ROOT%\downloads\runtimes\onnxruntime-directml"
set "ARTIFACT=%ROOT%\downloads\models\optimized\fcpe\fcpe-core.onnx"

if not exist "%PY%" (
  echo [ERROR] Backend virtual environment was not found. Run start-dev.bat once first.
  exit /b 1
)

if not exist "%RUNTIME%\onnxruntime\__init__.py" if not exist "%ARTIFACT%" goto :prepare
if not exist "%RUNTIME%\onnxruntime\__init__.py" goto :prepare
if not exist "%ARTIFACT%" goto :prepare
goto :run

:prepare
pushd "%ROOT%\scripts" >nul || exit /b 1
call test-directml-isolation.bat
set "PREP_RC=%ERRORLEVEL%"
popd
if not "%PREP_RC%"=="0" exit /b %PREP_RC%

:run
if exist "%ENV%" call "%ENV%" >nul 2>&1
set "PYTHONPATH=%KARAOKE_AI_ORT_DIRECTML_PATH%;%ROOT%\backend"
if "%~1"=="" (
  "%PY%" "%ROOT%\scripts\ai_runtime_benchmark\directml_fcpe_downstream_gate.py"
) else (
  "%PY%" "%ROOT%\scripts\ai_runtime_benchmark\directml_fcpe_downstream_gate.py" "%~1"
)
exit /b %ERRORLEVEL%
