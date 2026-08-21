@echo off
setlocal EnableExtensions
for %%I in ("%~dp0.") do set "ROOT=%%~fI"
if not exist "%ROOT%\backend\venv\Scripts\python.exe" (
  echo Preparing dependencies...
  call "%ROOT%\start-dev.bat" --prepare-only || exit /b 1
)
cd /d "%ROOT%\front" || exit /b 1
call npm run dev:web
exit /b %errorlevel%
