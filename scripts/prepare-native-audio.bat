@echo off
setlocal EnableExtensions

if "%~1"=="" (for %%I in ("%~dp0..") do set "ROOT=%%~fI") else for %%I in ("%~1") do set "ROOT=%%~fI"

call "%ROOT%\scripts\install-asio-sdk.bat" "%ROOT%"
if errorlevel 1 exit /b 1

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\prepare-native-audio.ps1" -Root "%ROOT%"
exit /b %errorlevel%
