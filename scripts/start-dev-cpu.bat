@echo off
setlocal EnableExtensions
for %%I in ("%~dp0..") do set "ROOT=%%~fI"

echo.
echo ============================================================
echo  A^&D Voice - Development - Forced CPU Test
echo ============================================================
echo.
echo This run forces every production AI stage to the safe CPU backend.
echo Close the normal dev instance first, then process one song through the UI.
echo Expected startup plan: pytorch:cpu:fp32 for every stage.
echo.

set "KARAOKE_AI_RUNTIME_OVERRIDE=cpu"
set "SONGAPP_DEVICE=cpu"
call "%ROOT%\start-dev.bat"
exit /b %ERRORLEVEL%
