@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
set "PY=%ROOT%backend\venv\Scripts\python.exe"
set "INPUT=%~1"
set "SECONDS=%~2"
set "THREADS=%~3"
if not defined SECONDS set "SECONDS=8"
if not defined THREADS set "THREADS=20"
if not exist "%PY%" (
  echo [FAIL] Backend venv Python not found: %PY%
  exit /b 2
)
if not defined INPUT (
  echo Usage: %~nx0 "C:\path\song.mp3" [seconds] [threads]
  exit /b 2
)
"%PY%" "%ROOT%strict_onnx_roformer_cpu_test_v2.py" "%INPUT%" --seconds "%SECONDS%" --threads "%THREADS%"
exit /b %errorlevel%
