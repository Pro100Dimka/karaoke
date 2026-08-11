@echo off
setlocal EnableExtensions

rem ============================================================================
rem INTERNAL PARALLEL JOBS
rem ============================================================================

if /i "%~1"=="--front-job" goto :front_job
if /i "%~1"=="--ai-job"    goto :ai_job

title A^&D Voice - Development

rem ============================================================================
rem CONFIG
rem ============================================================================

set "ROOT=%~dp0"
set "BACK=%ROOT%backend"
set "FRONT=%ROOT%front"

set "VENV=%BACK%\venv"
set "PY=%VENV%\Scripts\python.exe"

set "VER=3.12.10"

set "RT=%ROOT%downloads\runtimes\python312"
set "RTPY=%RT%\tools\python.exe"

set "ZIP=%TEMP%\advoice-python-%VER%.zip"
set "URL=https://api.nuget.org/v3-flatcontainer/python/%VER%/python.%VER%.nupkg"

set "AI=%ROOT%scripts\install-ai-models.bat"

rem ============================================================================
rem PARALLEL JOB FILES
rem ============================================================================

set "JOB_DIR=%TEMP%\advoice-dev-%RANDOM%-%RANDOM%"

set "FRONT_RC=%JOB_DIR%\front.rc"
set "FRONT_LOG=%JOB_DIR%\front.log"

set "AI_RC=%JOB_DIR%\ai.rc"
set "AI_LOG=%JOB_DIR%\ai.log"

mkdir "%JOB_DIR%" >nul 2>&1 || goto :err

rem ============================================================================
rem HEADER
rem ============================================================================

echo.
echo ============================================================
echo  A^&D Voice - Development
echo ============================================================
echo.

rem ============================================================================
rem PROJECT CHECK
rem ============================================================================

for %%D in ("%BACK%" "%FRONT%") do (
    if not exist "%%~D" (
        echo [ERROR] Directory not found:
        echo   %%~D
        goto :err
    )
)

if not exist "%AI%" (
    echo [ERROR] AI installer not found:
    echo   %AI%
    goto :err
)

rem ============================================================================
rem FRONTEND - START IN PARALLEL
rem ============================================================================
rem
rem Frontend dependencies do not depend on Python, so start them immediately.
rem They will install in parallel while Python/backend are prepared.
rem ============================================================================

echo Starting frontend preparation in parallel...

start "" /b cmd.exe /c call "%~f0" --front-job "%FRONT%" "%FRONT_LOG%" "%FRONT_RC%"

rem ============================================================================
rem PYTHON / VENV
rem ============================================================================

if exist "%PY%" (
    "%PY%" -c "import sys;exit(sys.version_info[:2]!=(3,12))" >nul 2>&1

    if not errorlevel 1 goto :venv

    echo.
    echo Recreating invalid virtual environment:
    echo   %VENV%

    rmdir /s /q "%VENV%" >nul 2>&1
)

call :runtime || goto :err

echo.
echo Creating backend virtual environment:
echo   %VENV%
echo.

"%RTPY%" -m venv "%VENV%" || goto :err

if not exist "%PY%" (
    echo [ERROR] Virtual environment was not created correctly.
    goto :err
)

rem ============================================================================
rem PYTHON PACKAGES
rem ============================================================================

echo.
echo Preparing Python packages...
echo.

"%PY%" -m pip install ^
    --disable-pip-version-check ^
    --prefer-binary ^
    -U pip setuptools wheel || goto :err

rem Install both requirement files in ONE pip invocation.
rem This avoids resolving dependencies twice.

if exist "%BACK%\requirements.txt" (
    if exist "%BACK%\requirements-dev.txt" (
        echo Installing requirements.txt + requirements-dev.txt...

        "%PY%" -m pip install ^
            --disable-pip-version-check ^
            --prefer-binary ^
            -r "%BACK%\requirements.txt" ^
            -r "%BACK%\requirements-dev.txt" || goto :err

    ) else (
        echo Installing requirements.txt...

        "%PY%" -m pip install ^
            --disable-pip-version-check ^
            --prefer-binary ^
            -r "%BACK%\requirements.txt" || goto :err
    )

) else if exist "%BACK%\requirements-dev.txt" (
    echo Installing requirements-dev.txt...

    "%PY%" -m pip install ^
        --disable-pip-version-check ^
        --prefer-binary ^
        -r "%BACK%\requirements-dev.txt" || goto :err
)

rem ============================================================================
rem VENV READY
rem ============================================================================

:venv

call "%VENV%\Scripts\activate.bat" || goto :err

echo.
echo Python:
"%PY%" --version

echo Venv:
echo   %VIRTUAL_ENV%

echo.

rem ============================================================================
rem AI - START IN PARALLEL
rem ============================================================================

echo Starting AI Core preparation in parallel...

start "" /b cmd.exe /c call "%~f0" --ai-job "%AI%" "%ROOT%" "%AI_LOG%" "%AI_RC%"

rem ============================================================================
rem PORT CLEANUP
rem ============================================================================
rem
rem Do this while AI installer is running.
rem ============================================================================

echo.
echo Stopping processes on ports 8000 and 5173...

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ports=8000,5173;" ^
    "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |" ^
    "Where-Object { $_.LocalPort -in $ports } |" ^
    "ForEach-Object {" ^
    "Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue" ^
    "}"

rem ============================================================================
rem WAIT FOR PARALLEL TASKS
rem ============================================================================

echo.
echo Waiting for parallel preparation tasks...
echo.

call :wait_parallel

set "FRONT_CODE="
set "AI_CODE="

set /p FRONT_CODE=<"%FRONT_RC%"
set /p AI_CODE=<"%AI_RC%"

if not "%FRONT_CODE%"=="0" (
    echo.
    echo ============================================================
    echo [ERROR] Frontend preparation failed.
    echo ============================================================
    echo.

    if exist "%FRONT_LOG%" type "%FRONT_LOG%"

    goto :err
)

if not "%AI_CODE%"=="0" (
    echo.
    echo ============================================================
    echo [ERROR] AI Core preparation failed.
    echo ============================================================
    echo.

    if exist "%AI_LOG%" type "%AI_LOG%"

    goto :err
)

rem ============================================================================
rem AI ENVIRONMENT
rem ============================================================================

if exist "%ROOT%downloads\ai-environment.bat" (
    call "%ROOT%downloads\ai-environment.bat"
)

rem ============================================================================
rem CLEAN TEMP JOB DATA
rem ============================================================================

rmdir /s /q "%JOB_DIR%" >nul 2>&1

rem ============================================================================
rem START APPLICATION
rem ============================================================================

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
rem LOCAL PYTHON
rem ============================================================================

:runtime

if exist "%RTPY%" (
    "%RTPY%" -c "import sys,venv;exit(sys.version_info[:3]!=(3,12,10))" >nul 2>&1

    if not errorlevel 1 (
        exit /b 0
    )
)

echo.
echo Local Python %VER% not found.
echo Preparing runtime:
echo   %RT%
echo.

rmdir /s /q "%RT%" >nul 2>&1
del /q "%ZIP%" >nul 2>&1

mkdir "%RT%" || exit /b 1

echo Downloading Python %VER%...

where curl.exe >nul 2>&1

if not errorlevel 1 (
    curl.exe ^
        -LfsS ^
        --retry 5 ^
        --retry-delay 2 ^
        -o "%ZIP%" ^
        "%URL%"
)

if not exist "%ZIP%" (
    echo curl failed. Trying PowerShell...

    powershell.exe ^
        -NoProfile ^
        -ExecutionPolicy Bypass ^
        -Command ^
        "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '%URL%' -OutFile '%ZIP%'"
)

if not exist "%ZIP%" (
    echo.
    echo [ERROR] Python runtime download failed.
    exit /b 1
)

for %%F in ("%ZIP%") do (
    if %%~zF==0 (
        echo.
        echo [ERROR] Downloaded Python package is empty.

        del /q "%ZIP%" >nul 2>&1

        exit /b 1
    )
)

echo Extracting Python...

powershell.exe ^
    -NoProfile ^
    -ExecutionPolicy Bypass ^
    -Command ^
    "Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%RT%' -Force" || exit /b 1

del /q "%ZIP%" >nul 2>&1

if not exist "%RTPY%" (
    echo.
    echo [ERROR] Python executable not found:
    echo   %RTPY%

    exit /b 1
)

"%RTPY%" -c "import sys,venv;exit(sys.version_info[:3]!=(3,12,10))" >nul 2>&1

if errorlevel 1 (
    echo.
    echo [ERROR] Invalid Python runtime:
    echo   %RTPY%

    exit /b 1
)

echo Local Python %VER% ready.

exit /b 0

rem ============================================================================
rem WAIT FOR BACKGROUND JOBS WITH LIVE STATUS
rem ============================================================================

:wait_parallel

set /a WAIT_SECONDS=0
set "LAST_FRONT_SIZE=-1"
set "LAST_AI_SIZE=-1"

:wait_parallel_loop

call :job_state "%FRONT_RC%" FRONT_STATE
call :job_state "%AI_RC%" AI_STATE

echo [WAIT %WAIT_SECONDS%s] Frontend: %FRONT_STATE% ^| AI Core: %AI_STATE%

call :show_log_tail "Frontend" "%FRONT_LOG%" LAST_FRONT_SIZE
call :show_log_tail "AI" "%AI_LOG%" LAST_AI_SIZE

if exist "%FRONT_RC%" if exist "%AI_RC%" (
    echo.
    echo Parallel preparation finished.
    exit /b 0
)

timeout /t 3 /nobreak >nul
set /a WAIT_SECONDS+=3
echo.
goto :wait_parallel_loop

rem ============================================================================
rem BACKGROUND JOB STATE
rem ============================================================================

:job_state

if exist "%~1" (
    set "%~2=DONE"
) else (
    set "%~2=RUNNING"
)

exit /b 0

rem ============================================================================
rem SHOW NEWEST BACKGROUND LOG LINE WHEN LOG CHANGES
rem ============================================================================

:show_log_tail

setlocal EnableExtensions
set "LABEL=%~1"
set "LOG=%~2"
set "SIZE=0"

if not exist "%LOG%" (
    endlocal
    exit /b 0
)

for %%F in ("%LOG%") do set "SIZE=%%~zF"

call set "OLD_SIZE=%%%~3%%"

if "%SIZE%"=="%OLD_SIZE%" (
    endlocal
    exit /b 0
)

for /f "usebackq delims=" %%L in (`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$p='%LOG%';if(Test-Path -LiteralPath $p){$x=Get-Content -LiteralPath $p -Tail 1 -ErrorAction SilentlyContinue;if($null -ne $x){$x}}"`) do (
    echo   %LABEL%: %%L
)

endlocal & set "%~3=%SIZE%"
exit /b 0

rem ============================================================================
rem FRONTEND BACKGROUND JOB
rem ============================================================================

:front_job

setlocal EnableExtensions

set "JOB_FRONT=%~2"
set "JOB_LOG=%~3"
set "JOB_RC=%~4"

cd /d "%JOB_FRONT%" >"%JOB_LOG%" 2>&1

if errorlevel 1 (
    >"%JOB_RC%" echo 1
    exit /b 1
)

rem Existing node_modules -> nothing to install.

if exist "%JOB_FRONT%\node_modules" (
    >>"%JOB_LOG%" echo Frontend dependencies already exist.
    >"%JOB_RC%" echo 0

    exit /b 0
)

if exist "%JOB_FRONT%\package-lock.json" (
    >>"%JOB_LOG%" echo Running npm ci...
    call npm ci >>"%JOB_LOG%" 2>&1
) else (
    >>"%JOB_LOG%" echo Running npm install...
    call npm install >>"%JOB_LOG%" 2>&1
)

set "JOB_ERROR=%errorlevel%"

>"%JOB_RC%" echo %JOB_ERROR%

exit /b %JOB_ERROR%

rem ============================================================================
rem AI BACKGROUND JOB
rem ============================================================================

:ai_job

setlocal EnableExtensions

set "JOB_AI=%~2"
set "JOB_ROOT=%~3"
set "JOB_LOG=%~4"
set "JOB_RC=%~5"

call "%JOB_AI%" "%JOB_ROOT%" >"%JOB_LOG%" 2>&1

set "JOB_ERROR=%errorlevel%"

>"%JOB_RC%" echo %JOB_ERROR%

exit /b %JOB_ERROR%

rem ============================================================================
rem ERROR
rem ============================================================================

:err

if defined JOB_DIR (
    rmdir /s /q "%JOB_DIR%" >nul 2>&1
)

echo.
echo ============================================================
echo [ERROR] Development environment could not be started.
echo ============================================================
echo.

pause

exit /b 1