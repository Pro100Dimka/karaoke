@echo off
setlocal
set "ROOT=%~dp0"
set "WORKER_URL=https://karaoke-studio-online.pro100dimka-and.workers.dev"

echo Testing A&D Voice online room server...
node "%ROOT%scripts\test-online-room.mjs" "%WORKER_URL%"
if errorlevel 1 (
  echo.
  echo Online room test failed. Check the Worker deployment and Internet connection.
  exit /b 1
)
echo.
echo Online room test completed successfully.
