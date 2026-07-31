@echo off
setlocal
cd /d "%~dp0front"
call npm run build:electron
