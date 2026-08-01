@echo off
setlocal
set "ROOT=%~dp0"
set "PYTHON=%ROOT%backend\venv\Scripts\python.exe"

if not exist "%PYTHON%" (
  echo Backend virtual environment was not found.
  echo Run: cd /d "%ROOT%backend" ^&^& python -m venv venv ^&^& venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-dev.txt
  exit /b 1
)

call "%ROOT%scripts\ensure-offline-models.bat"
if errorlevel 1 exit /b 1

echo Stopping the previous backend on port 8000...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force }"
start "Karaoke Backend" /D "%ROOT%backend" /MIN cmd /k ""%PYTHON%" run.py"
timeout /t 2 /nobreak >nul
set "KARAOKE_BACKEND_EXTERNAL=1"
cd /d "%ROOT%front"
call npm run dev:electron
