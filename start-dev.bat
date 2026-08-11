@echo off
setlocal EnableExtensions EnableDelayedExpansion
if /i "%~1"=="--job" goto :job
title A^&D Voice - Development

set "ROOT=%~dp0"
set "BACK=%ROOT%backend"
set "FRONT=%ROOT%front"
set "VENV=%BACK%\venv"
set "PY=%VENV%\Scripts\python.exe"

set "VER=3.12.10"
set "RT=%ROOT%downloads\runtimes\python312"
set "RTPY=%RT%\tools\python.exe"
set "PKG=%TEMP%\advoice-python-%VER%.zip"
set "URL=https://api.nuget.org/v3-flatcontainer/python/%VER%/python.%VER%.nupkg"

set "AI=%ROOT%scripts\install-ai-models.bat"
set "ASIO=%ROOT%scripts\install-asio-sdk.bat"
set "JOBS=%TEMP%\advoice-dev-%RANDOM%-%RANDOM%"

set "PYTHONHOME="
set "PYTHONPATH="

for %%J in (FRONT AI ASIO) do (
    set "%%J_RC=%JOBS%\%%J.rc"
    set "%%J_LOG=%JOBS%\%%J.log"
)

echo.
echo ============================================================
echo  A^&D Voice - Development
echo ============================================================
echo.

for %%D in ("%BACK%" "%FRONT%") do if not exist "%%~D\" (
    echo [ERROR] Directory not found: %%~D
    goto :err
)

for %%F in ("%AI%" "%ASIO%") do if not exist "%%~F" (
    echo [ERROR] Script not found: %%~F
    goto :err
)

mkdir "%JOBS%" >nul 2>&1 || goto :err

call :start front "%FRONT%" "" "%FRONT_LOG%" "%FRONT_RC%"
call :start asio "%ASIO%" "%ROOT%" "%ASIO_LOG%" "%ASIO_RC%"

rem ============================================================================
rem PYTHON
rem ============================================================================

if exist "%PY%" (
    "%PY%" -c "import sys;raise SystemExit(0 if sys.version_info[:3]==(3,12,10) else 1)" >nul 2>&1
    if not errorlevel 1 goto :venv

    echo Recreating invalid virtual environment...
    rmdir /s /q "%VENV%" >nul 2>&1
)

call :runtime
if errorlevel 1 goto :err

echo.
echo Creating backend virtual environment:
echo   %VENV%
echo.

"%RTPY%" -m venv "%VENV%"
if errorlevel 1 goto :err

if not exist "%PY%" (
    echo [ERROR] Virtual environment was not created:
    echo   %VENV%
    goto :err
)

"%PY%" -m pip install --disable-pip-version-check --prefer-binary -U pip setuptools wheel
if errorlevel 1 goto :err

if exist "%BACK%\requirements.txt" (
    if exist "%BACK%\requirements-dev.txt" (
        "%PY%" -m pip install --disable-pip-version-check --prefer-binary ^
            -r "%BACK%\requirements.txt" ^
            -r "%BACK%\requirements-dev.txt"
    ) else (
        "%PY%" -m pip install --disable-pip-version-check --prefer-binary ^
            -r "%BACK%\requirements.txt"
    )

    if errorlevel 1 goto :err
) else if exist "%BACK%\requirements-dev.txt" (
    "%PY%" -m pip install --disable-pip-version-check --prefer-binary ^
        -r "%BACK%\requirements-dev.txt"

    if errorlevel 1 goto :err
)

:venv

call "%VENV%\Scripts\activate.bat"
if errorlevel 1 goto :err

echo.
echo Python:
"%PY%" --version
echo Venv:
echo   %VIRTUAL_ENV%
echo.

call :start ai "%AI%" "%ROOT%" "%AI_LOG%" "%AI_RC%"

rem ============================================================================
rem PORTS
rem ============================================================================

echo Stopping processes on ports 8000 and 5173...

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
"$p=8000,5173;$c=Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue;foreach($x in $c){if($p -contains $x.LocalPort){Stop-Process -Id $x.OwningProcess -Force -ErrorAction SilentlyContinue}}"

if errorlevel 1 echo [WARN] Could not fully clean development ports.

rem ============================================================================
rem WAIT
rem ============================================================================

echo.
echo ============================================================
echo  Preparing development environment
echo ============================================================
echo.

call :wait

for %%J in (FRONT ASIO AI) do (
    call :result %%J
    if errorlevel 1 goto :err
)

if exist "%ROOT%downloads\ai-environment.bat" (
    echo Loading AI environment...
    call "%ROOT%downloads\ai-environment.bat"
    if errorlevel 1 goto :err
)

rmdir /s /q "%JOBS%" >nul 2>&1
set "KARAOKE_PYTHON=%PY%"

echo.
echo ============================================================
echo  Starting A^&D Voice
echo ============================================================
echo.

cd /d "%FRONT%" || goto :err
call npm run dev:electron
exit /b %errorlevel%

rem ============================================================================
rem START JOB
rem ============================================================================

:start
echo Starting %~1 preparation...
start "" /b cmd.exe /c call "%~f0" --job "%~1" "%~2" "%~3" "%~4" "%~5"
exit /b 0

rem ============================================================================
rem LOCAL PYTHON
rem ============================================================================

:runtime

if exist "%RTPY%" (
    call :check_runtime
    if not errorlevel 1 exit /b 0

    echo Existing local Python runtime is invalid. Recreating...
)

echo Preparing local Python %VER%...

rmdir /s /q "%RT%" >nul 2>&1
del /q "%PKG%" >nul 2>&1

mkdir "%RT%" || exit /b 1

echo Downloading Python %VER%...

where curl.exe >nul 2>&1
if not errorlevel 1 (
    curl.exe -LfsS --retry 5 --retry-delay 2 -o "%PKG%" "%URL%"
)

if not exist "%PKG%" (
    echo curl failed. Trying PowerShell...

    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ProgressPreference='SilentlyContinue';Invoke-WebRequest -UseBasicParsing -Uri '%URL%' -OutFile '%PKG%'"

    if errorlevel 1 exit /b 1
)

if not exist "%PKG%" (
    echo [ERROR] Python download failed.
    exit /b 1
)

for %%F in ("%PKG%") do if %%~zF==0 (
    echo [ERROR] Downloaded Python package is empty.
    exit /b 1
)

echo Extracting Python...

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
"Expand-Archive -LiteralPath '%PKG%' -DestinationPath '%RT%' -Force"

if errorlevel 1 (
    echo [ERROR] Python extraction failed.
    exit /b 1
)

del /q "%PKG%" >nul 2>&1

call :check_runtime
exit /b %errorlevel%

rem ============================================================================
rem VERIFY LOCAL PYTHON
rem ============================================================================

:check_runtime

if not exist "%RTPY%" (
    echo [ERROR] Python executable not found:
    echo   %RTPY%
    exit /b 1
)

echo.
echo Checking local Python runtime:
echo   %RTPY%

"%RTPY%" --version
if errorlevel 1 (
    echo [ERROR] Python executable cannot start.
    exit /b 1
)

"%RTPY%" -c "import sys;print('Executable:',sys.executable);print('Version:',sys.version);raise SystemExit(0 if sys.version_info[:3]==(3,12,10) else 1)"

if errorlevel 1 (
    echo [ERROR] Expected Python %VER%.
    exit /b 1
)

"%RTPY%" -c "import venv;print('venv: OK')"

if errorlevel 1 (
    echo [ERROR] Python venv module is unavailable.
    exit /b 1
)

echo Local Python %VER% ready.
exit /b 0

rem ============================================================================
rem WAIT
rem ============================================================================

:wait
set /a SEC=0

:wait_loop

if exist "%FRONT_RC%" if exist "%ASIO_RC%" if exist "%AI_RC%" (
    echo.
    echo Parallel preparation finished.
    exit /b 0
)

set /a MOD=SEC%%15

if !MOD!==0 (
    for %%J in (FRONT AI ASIO) do call :state %%J

    echo.
    echo [STATUS !SEC!s] Frontend: !FRONT_STATE! ^| AI Core: !AI_STATE! ^| ASIO: !ASIO_STATE!

    for %%J in (FRONT AI ASIO) do call :tail %%J
)

timeout /t 1 /nobreak >nul
set /a SEC+=1
goto :wait_loop

rem ============================================================================
rem STATE
rem ============================================================================

:state

call set "R=%%%~1_RC%%"
set "%~1_STATE=RUNNING"

if not exist "%R%" exit /b 0

set "C="
set /p C=<"%R%"

if "!C!"=="0" (
    set "%~1_STATE=DONE"
) else (
    set "%~1_STATE=FAILED"
)

exit /b 0

rem ============================================================================
rem LOG
rem ============================================================================

:tail

setlocal DisableDelayedExpansion
call set "L=%%%~1_LOG%%"

if not exist "%L%" (
    endlocal
    exit /b 0
)

set "ADVOICE_LOG=%L%"
set "ADVOICE_NAME=%~1"

for /f "usebackq delims=" %%L in (`
    powershell.exe -NoProfile -Command ^
    "$p=$env:ADVOICE_LOG;if(Test-Path -LiteralPath $p){Get-Content -LiteralPath $p -Tail 3 -ErrorAction SilentlyContinue|Where-Object{-not [string]::IsNullOrWhiteSpace($_)}|ForEach-Object{'  '+$env:ADVOICE_NAME+': '+$_}}"
`) do echo %%L

endlocal
exit /b 0

rem ============================================================================
rem RESULT
rem ============================================================================

:result

call set "R=%%%~1_RC%%"
call set "L=%%%~1_LOG%%"

if exist "%R%" (
    set "C="
    set /p C=<"%R%"

    if "!C!"=="0" (
        echo [%~1] DONE
        exit /b 0
    )
)

echo.
echo ============================================================
echo [ERROR] %~1 preparation failed.
echo ============================================================
echo.

if exist "%L%" type "%L%"
exit /b 1

rem ============================================================================
rem JOB
rem ============================================================================

:job

setlocal EnableExtensions EnableDelayedExpansion

set "NAME=%~2"
set "TARGET=%~3"
set "ARG=%~4"
set "LOG=%~5"
set "RC=%~6"

>"%LOG%" echo %NAME% worker started.

if /i "%NAME%"=="front" (
    cd /d "%TARGET%" >>"%LOG%" 2>&1 || goto :job_fail

    if exist "%TARGET%\node_modules\" (
        >>"%LOG%" echo Frontend dependencies already exist.
        >"%RC%" echo 0
        exit /b 0
    )

    if exist "%TARGET%\package-lock.json" (
        call npm ci >>"%LOG%" 2>&1
    ) else (
        call npm install >>"%LOG%" 2>&1
    )
) else (
    if not exist "%TARGET%" goto :job_fail
    call "%TARGET%" "%ARG%" >>"%LOG%" 2>&1
)

set "E=!errorlevel!"
>"%RC%" echo !E!

exit /b !E!

:job_fail

>"%RC%" echo 1
exit /b 1

rem ============================================================================
rem ERROR
rem ============================================================================

:err

echo.
echo ============================================================
echo [ERROR] Development environment could not be started.
echo ============================================================
echo.

if defined JOBS (
    echo Logs:
    echo   %JOBS%
    echo.
)

pause
exit /b 1