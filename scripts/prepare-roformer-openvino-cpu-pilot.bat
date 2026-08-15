@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "PY=%ROOT%\backend\venv\Scripts\python.exe"
set "VERSION=2026.2.1"

if not exist "%PY%" (
  echo [ERROR] Backend venv Python not found: %PY%
  exit /b 1
)

echo.
echo ============================================================
echo  A^&D Voice - OpenVINO CPU Pilot Preparation
echo ============================================================
echo.
echo Checking OpenVINO %VERSION% in the existing development venv.
echo This is a pilot dependency only; it is not added to production installer.
echo.

"%PY%" -c "import openvino, openvino.torch, sys; sys.exit(0 if openvino.__version__.startswith('%VERSION%') else 1)" >nul 2>nul
if errorlevel 1 (
  echo OpenVINO %VERSION% is not ready. Installing...
  "%PY%" -m pip install --disable-pip-version-check "openvino==%VERSION%"
  if errorlevel 1 exit /b 1
) else (
  echo OpenVINO %VERSION% is already installed.
)

"%PY%" -c "import openvino, openvino.torch; print('OpenVINO:', openvino.__version__)"
if errorlevel 1 exit /b 1

echo.
echo [OK] OpenVINO CPU pilot runtime is ready.
exit /b 0
