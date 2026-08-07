@echo off
setlocal
set "ROOT=%~dp0"

echo Opening a second A&D Voice window as an online client...
echo Start start-dev.bat first. This window uses the existing local backend.
set "KARAOKE_BACKEND_EXTERNAL=1"
set "KARAOKE_ELECTRON_PROFILE=%ROOT%front\.runtime\electron-profile-online-client"
cd /d "%ROOT%front"
call npx electron .
