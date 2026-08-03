@echo off
setlocal
set "ROOT=%~dp0"
set "PYTHON=%ROOT%backend\venv\Scripts\python.exe"

if not exist "%PYTHON%" (
  echo Backend virtual environment was not found.
  echo Run: cd /d "%ROOT%backend" ^&^& python -m venv venv ^&^& venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-dev.txt
  exit /b 1
)

rem -----------------------------------------------------------------------------
rem DEV: OPTIONAL RESET SAVED AUDIO SETTINGS
rem Settings are preserved by default. To reset only microphone/ASIO settings
rem for a clean test, remove "rem " from the three commands below.
rem -----------------------------------------------------------------------------
rem if exist "%ROOT%backend\data\app.db" (
rem   "%PYTHON%" -c "import sqlite3; db=sqlite3.connect(r'%ROOT%backend\data\app.db'); db.execute('DELETE FROM audio_settings'); db.commit(); db.close()"
rem )
rem -----------------------------------------------------------------------------
rem END DEV: RESET SAVED AUDIO SETTINGS
rem -----------------------------------------------------------------------------

call "%ROOT%scripts\ensure-offline-models.bat"
if errorlevel 1 exit /b 1

echo Stopping previous development processes on ports 8000 and 5173...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports = 8000,5173; Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in $ports } | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
set "KARAOKE_PYTHON=%PYTHON%"
cd /d "%ROOT%front"
call npm run dev:electron
