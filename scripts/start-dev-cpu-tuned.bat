@echo off
setlocal EnableExtensions
call "%~dp0start-dev-cpu.bat" %*
exit /b %ERRORLEVEL%
