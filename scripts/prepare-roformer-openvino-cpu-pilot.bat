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
echo Installing OpenVINO %VERSION% into the existing development venv.
echo This is a pilot dependency only; it is not added to production installer.
echo.

"%PY%" -m pip install --disable-pip-version-check "openvino==%VERSION%"
if errorlevel 1 exit /b 1

"%PY%" -c "import openvino, openvino.torch; print('OpenVINO:', openvino.__version__)"
if errorlevel 1 exit /b 1

echo.
echo [OK] OpenVINO CPU pilot runtime is ready.
exit /b 0
