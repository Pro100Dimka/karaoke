@echo off
setlocal EnableExtensions

rem Derive the root from this script, not from a nested quoted argument. A
rem trailing backslash in start-dev's ROOT can otherwise arrive as a literal
rem quote at the end of the PowerShell parameter.
for %%I in ("%~dp0..") do set "ROOT=%%~fI"

call "%ROOT%\scripts\install-asio-sdk.bat" "%ROOT%"
if errorlevel 1 exit /b 1

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\scripts\prepare-native-audio.ps1" -Root "%ROOT%"
exit /b %errorlevel%
