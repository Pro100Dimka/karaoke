@echo off
setlocal
echo Stopping the previous backend on port 8000...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force }"
start "Karaoke Backend" /D "%~dp0backend" /MIN cmd /k python run.py
timeout /t 2 /nobreak >nul
set "KARAOKE_BACKEND_EXTERNAL=1"
cd /d "%~dp0front"
call npm run dev:electron
