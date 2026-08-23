@echo off
setlocal EnableExtensions

rem Fast developer build: skip QA release gate and packaged runtime smoke test.
rem All required build dependency/environment checks remain enabled.
call "%~dp0build-installer.bat" -SkipReleaseGate -SkipPackageSmoke %*
exit /b %errorlevel%
