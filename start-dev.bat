@echo off
setlocal EnableExtensions

title A^&D Voice - Development

rem ============================================================================
rem CONFIG
rem ============================================================================

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%front"
set "SCRIPTS=%ROOT%scripts"

set "DOWNLOADS=%ROOT%downloads"
set "RUNTIMES=%DOWNLOADS%\runtimes"

set "VENV=%BACKEND%\venv"
set "PYTHON=%VENV%\Scripts\python.exe"
set "ACTIVATE=%VENV%\Scripts\activate.bat"

set "PY_VERSION=3.12.10"

set "PY_RUNTIME=%RUNTIMES%\python312"
set "PY_RUNTIME_EXE=%PY_RUNTIME%\tools\python.exe"

set "PY_ARCHIVE=%TEMP%\advoice-python-%PY_VERSION%.zip"
set "PY_URL=https://api.nuget.org/v3-flatcontainer/python/%PY_VERSION%/python.%PY_VERSION%.nupkg"

echo.
echo ============================================================
echo  A^&D Voice - Development
echo ============================================================
echo.

rem ============================================================================
rem CHECK PROJECT
rem ============================================================================

if not exist "%BACKEND%\" (
    echo [ERROR] Backend directory was not found:
    echo   %BACKEND%
    goto :error
)

if not exist "%FRONTEND%\" (
    echo [ERROR] Frontend directory was not found:
    echo   %FRONTEND%
    goto :error
)

rem ============================================================================
rem ENSURE BACKEND VENV
rem ============================================================================

if not exist "%PYTHON%" (
    echo Backend virtual environment was not found:
    echo   %VENV%
    echo.

    call :ensure_python
    if errorlevel 1 goto :error

    call :create_venv
    if errorlevel 1 goto :error
)

rem ============================================================================
rem VERIFY EXISTING VENV
rem ============================================================================

"%PYTHON%" -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3,12) else 1)" >nul 2>&1

if errorlevel 1 (
    echo Existing backend virtual environment does not use Python 3.12.
    echo Recreating:
    echo   %VENV%
    echo.

    call :ensure_python
    if errorlevel 1 goto :error

    call :remove_venv
    if errorlevel 1 goto :error

    call :create_venv
    if errorlevel 1 goto :error
)

rem ============================================================================
rem ACTIVATE CORRECT VENV
rem ============================================================================

call :activate_venv
if errorlevel 1 goto :error

rem ============================================================================
rem ENVIRONMENT INFO
rem ============================================================================

echo.
echo ============================================================
echo  Python environment
echo ============================================================
echo.

echo Runtime:
echo   %PY_RUNTIME_EXE%
echo.

echo Active venv:
echo   %VIRTUAL_ENV%
echo.

echo Python:
echo   %PYTHON%
echo.

"%PYTHON%" --version

rem ============================================================================
rem DEV: OPTIONAL RESET SAVED AUDIO SETTINGS
rem ============================================================================
rem
rem Settings are preserved by default.
rem To reset only microphone/ASIO settings for a clean test,
rem remove "rem " from the commands below.
rem
rem if exist "%ROOT%data\app.db" (
rem     "%PYTHON%" -c "import sqlite3; db=sqlite3.connect(r'%ROOT%data\app.db'); db.execute('DELETE FROM audio_settings'); db.commit(); db.close()"
rem )
rem
rem ============================================================================

rem ============================================================================
rem ENSURE OFFLINE AI MODELS
rem ============================================================================

if exist "%SCRIPTS%\ensure-offline-models.bat" (
    echo.
    echo Checking offline AI resources...
    echo.

    call "%SCRIPTS%\ensure-offline-models.bat"

    if errorlevel 1 (
        echo.
        echo [ERROR] Failed to prepare offline AI resources.
        goto :error
    )
) else (
    echo.
    echo [WARNING] Offline model checker was not found:
    echo   %SCRIPTS%\ensure-offline-models.bat
    echo.
)

rem ============================================================================
rem STOP OLD DEVELOPMENT PROCESSES
rem ============================================================================

echo.
echo Stopping previous development processes on ports 8000 and 5173...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports=8000,5173; $owners=Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in $ports } | Select-Object -ExpandProperty OwningProcess -Unique; foreach($ownerPid in $owners){ $process=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $ownerPid) -ErrorAction SilentlyContinue; if($process -and $process.Name -eq 'KaraokeBackend.exe' -and $process.ParentProcessId){ Stop-Process -Id $process.ParentProcessId -Force -ErrorAction SilentlyContinue }; Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue }"

rem ============================================================================
rem START DEVELOPMENT
rem ============================================================================

set "KARAOKE_PYTHON=%PYTHON%"

echo.
echo ============================================================
echo  Starting A^&D Voice
echo ============================================================
echo.

cd /d "%FRONTEND%"

call npm run dev:electron

set "EXIT_CODE=%ERRORLEVEL%"

exit /b %EXIT_CODE%


rem ============================================================================
rem ENSURE LOCAL PYTHON 3.12
rem ============================================================================

:ensure_python

rem ----------------------------------------------------------------------------
rem VALID RUNTIME ALREADY EXISTS
rem ----------------------------------------------------------------------------

if exist "%PY_RUNTIME_EXE%" (
    "%PY_RUNTIME_EXE%" -c "import sys; raise SystemExit(0 if sys.version_info[:3] == (3,12,10) else 1)" >nul 2>&1

    if not errorlevel 1 (
        echo Local Python %PY_VERSION% found:
        echo   %PY_RUNTIME_EXE%
        echo.
        exit /b 0
    )

    echo Existing Python runtime is invalid or has wrong version:
    echo   %PY_RUNTIME%
    echo.

    echo Removing invalid runtime...

    rmdir /s /q "%PY_RUNTIME%" >nul 2>&1

    if exist "%PY_RUNTIME%\" (
        echo.
        echo [ERROR] Failed to remove invalid Python runtime:
        echo   %PY_RUNTIME%
        exit /b 1
    )
)

rem ----------------------------------------------------------------------------
rem REMOVE INCOMPLETE RUNTIME
rem ----------------------------------------------------------------------------

if exist "%PY_RUNTIME%\" (
    echo Removing incomplete Python runtime:
    echo   %PY_RUNTIME%
    echo.

    rmdir /s /q "%PY_RUNTIME%" >nul 2>&1

    if exist "%PY_RUNTIME%\" (
        echo [ERROR] Failed to remove incomplete Python runtime.
        exit /b 1
    )
)

rem ----------------------------------------------------------------------------
rem CREATE DIRECTORIES
rem ----------------------------------------------------------------------------

if not exist "%DOWNLOADS%\" (
    mkdir "%DOWNLOADS%" >nul 2>&1

    if errorlevel 1 (
        echo.
        echo [ERROR] Failed to create:
        echo   %DOWNLOADS%
        exit /b 1
    )
)

if not exist "%RUNTIMES%\" (
    mkdir "%RUNTIMES%" >nul 2>&1

    if errorlevel 1 (
        echo.
        echo [ERROR] Failed to create:
        echo   %RUNTIMES%
        exit /b 1
    )
)

rem ----------------------------------------------------------------------------
rem DOWNLOAD PYTHON
rem ----------------------------------------------------------------------------

echo Python %PY_VERSION% runtime was not found.
echo.
echo Downloading local Python %PY_VERSION%...
echo.

if exist "%PY_ARCHIVE%" (
    del /q "%PY_ARCHIVE%" >nul 2>&1
)

where curl.exe >nul 2>&1

if not errorlevel 1 (
    curl.exe -L --fail --retry 5 --retry-delay 2 --output "%PY_ARCHIVE%" "%PY_URL%"
)

if not exist "%PY_ARCHIVE%" (
    echo.
    echo curl failed or is unavailable.
    echo Trying PowerShell...
    echo.

    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '%PY_URL%' -OutFile '%PY_ARCHIVE%'"

    if errorlevel 1 (
        echo.
        echo [ERROR] Failed to download Python %PY_VERSION%.
        exit /b 1
    )
)

if not exist "%PY_ARCHIVE%" (
    echo.
    echo [ERROR] Python archive was not downloaded:
    echo   %PY_ARCHIVE%
    exit /b 1
)

for %%F in ("%PY_ARCHIVE%") do set "ARCHIVE_SIZE=%%~zF"

if "%ARCHIVE_SIZE%"=="0" (
    echo.
    echo [ERROR] Downloaded Python archive is empty.

    del /q "%PY_ARCHIVE%" >nul 2>&1
    exit /b 1
)

echo.
echo Download completed.
echo.

rem ----------------------------------------------------------------------------
rem CREATE RUNTIME DIRECTORY
rem ----------------------------------------------------------------------------

mkdir "%PY_RUNTIME%" >nul 2>&1

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to create runtime directory:
    echo   %PY_RUNTIME%
    exit /b 1
)

rem ----------------------------------------------------------------------------
rem EXTRACT PYTHON
rem ----------------------------------------------------------------------------

echo Extracting Python to:
echo   %PY_RUNTIME%
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath '%PY_ARCHIVE%' -DestinationPath '%PY_RUNTIME%' -Force"

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to extract Python archive.

    if exist "%PY_RUNTIME%\" (
        rmdir /s /q "%PY_RUNTIME%" >nul 2>&1
    )

    exit /b 1
)

del /q "%PY_ARCHIVE%" >nul 2>&1

rem ----------------------------------------------------------------------------
rem VERIFY PYTHON.EXE
rem ----------------------------------------------------------------------------

if not exist "%PY_RUNTIME_EXE%" (
    echo.
    echo [ERROR] Python executable was not found after extraction.
    echo.
    echo Expected:
    echo   %PY_RUNTIME_EXE%
    echo.
    echo Runtime contents:
    echo.

    dir /b "%PY_RUNTIME%" 2>nul

    exit /b 1
)

echo Python runtime extracted successfully.
echo.

"%PY_RUNTIME_EXE%" --version

if errorlevel 1 (
    echo.
    echo [ERROR] Local Python could not be started:
    echo   %PY_RUNTIME_EXE%
    exit /b 1
)

"%PY_RUNTIME_EXE%" -c "import sys; raise SystemExit(0 if sys.version_info[:3] == (3,12,10) else 1)" >nul 2>&1

if errorlevel 1 (
    echo.
    echo [ERROR] Downloaded Python has unexpected version.
    echo.
    echo Actual:
    "%PY_RUNTIME_EXE%" --version
    exit /b 1
)

rem ----------------------------------------------------------------------------
rem VERIFY VENV SUPPORT
rem ----------------------------------------------------------------------------

"%PY_RUNTIME_EXE%" -c "import venv" >nul 2>&1

if errorlevel 1 (
    echo.
    echo [ERROR] Python runtime does not contain the venv module:
    echo   %PY_RUNTIME_EXE%
    exit /b 1
)

echo.
echo Local Python %PY_VERSION% is ready:
echo   %PY_RUNTIME_EXE%
echo.

exit /b 0


rem ============================================================================
rem REMOVE BACKEND VENV
rem ============================================================================

:remove_venv

set "CURRENT_VENV="
set "EXPECTED_VENV="

for %%A in ("%VENV%") do set "EXPECTED_VENV=%%~fA"

if defined VIRTUAL_ENV (
    for %%A in ("%VIRTUAL_ENV%") do set "CURRENT_VENV=%%~fA"
)

if defined CURRENT_VENV (
    if /I "%CURRENT_VENV%"=="%EXPECTED_VENV%" (
        echo Deactivating current backend virtual environment...

        if exist "%VENV%\Scripts\deactivate.bat" (
            call "%VENV%\Scripts\deactivate.bat"
        ) else (
            set "VIRTUAL_ENV="
            set "VIRTUAL_ENV_PROMPT="
        )
    )
)

if exist "%VENV%\" (
    echo Removing backend virtual environment:
    echo   %VENV%
    echo.

    rmdir /s /q "%VENV%" >nul 2>&1

    if exist "%VENV%\" (
        echo.
        echo [ERROR] Failed to remove backend virtual environment.
        echo Close all Python/backend processes and try again.
        exit /b 1
    )
)

exit /b 0


rem ============================================================================
rem CREATE BACKEND VENV
rem ============================================================================

:create_venv

if not exist "%PY_RUNTIME_EXE%" (
    echo.
    echo [ERROR] Local Python runtime was not found:
    echo   %PY_RUNTIME_EXE%
    exit /b 1
)

if exist "%VENV%\" (
    call :remove_venv
    if errorlevel 1 exit /b 1
)

echo Creating backend virtual environment:
echo   %VENV%
echo.

"%PY_RUNTIME_EXE%" -m venv "%VENV%"

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to create backend virtual environment.
    exit /b 1
)

if not exist "%PYTHON%" (
    echo.
    echo [ERROR] Virtual environment was not created correctly.
    echo.
    echo Expected:
    echo   %PYTHON%
    exit /b 1
)

"%PYTHON%" -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3,12) else 1)" >nul 2>&1

if errorlevel 1 (
    echo.
    echo [ERROR] Newly created virtual environment does not use Python 3.12.
    exit /b 1
)

echo Virtual environment created successfully.
echo.

rem ============================================================================
rem PREPARE PIP
rem ============================================================================

echo Preparing pip...
echo.

"%PYTHON%" -m ensurepip --upgrade >nul 2>&1

"%PYTHON%" -m pip install --disable-pip-version-check --upgrade pip setuptools wheel

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to prepare pip.
    exit /b 1
)

rem ============================================================================
rem BACKEND REQUIREMENTS
rem ============================================================================

if exist "%BACKEND%\requirements.txt" (
    echo.
    echo Installing backend requirements...
    echo.

    "%PYTHON%" -m pip install --disable-pip-version-check -r "%BACKEND%\requirements.txt"

    if errorlevel 1 (
        echo.
        echo [ERROR] Failed to install backend requirements.
        exit /b 1
    )
)

if exist "%BACKEND%\requirements-dev.txt" (
    echo.
    echo Installing backend development requirements...
    echo.

    "%PYTHON%" -m pip install --disable-pip-version-check -r "%BACKEND%\requirements-dev.txt"

    if errorlevel 1 (
        echo.
        echo [ERROR] Failed to install backend development requirements.
        exit /b 1
    )
)

echo.
echo Backend virtual environment is ready:
echo   %VENV%
echo.

exit /b 0


rem ============================================================================
rem ACTIVATE CORRECT BACKEND VENV
rem ============================================================================

:activate_venv

if not exist "%ACTIVATE%" (
    echo.
    echo [ERROR] Venv activation script was not found:
    echo   %ACTIVATE%
    exit /b 1
)

set "EXPECTED_VENV="
set "CURRENT_VENV="

for %%A in ("%VENV%") do set "EXPECTED_VENV=%%~fA"

if defined VIRTUAL_ENV (
    for %%A in ("%VIRTUAL_ENV%") do set "CURRENT_VENV=%%~fA"
)

rem ----------------------------------------------------------------------------
rem CORRECT VENV ALREADY ACTIVE
rem ----------------------------------------------------------------------------

if defined CURRENT_VENV (
    if /I "%CURRENT_VENV%"=="%EXPECTED_VENV%" (
        echo Correct backend virtual environment is already active:
        echo   %EXPECTED_VENV%
        echo.
        exit /b 0
    )
)

rem ----------------------------------------------------------------------------
rem ANOTHER VENV IS ACTIVE
rem ----------------------------------------------------------------------------

if defined CURRENT_VENV (
    echo Another virtual environment is active:
    echo   %CURRENT_VENV%
    echo.
    echo Switching to:
    echo   %EXPECTED_VENV%
    echo.

    if exist "%CURRENT_VENV%\Scripts\deactivate.bat" (
        call "%CURRENT_VENV%\Scripts\deactivate.bat"
    ) else (
        set "VIRTUAL_ENV="
        set "VIRTUAL_ENV_PROMPT="
    )
)

rem ----------------------------------------------------------------------------
rem ACTIVATE PROJECT VENV
rem ----------------------------------------------------------------------------

call "%ACTIVATE%"

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to activate backend virtual environment.
    exit /b 1
)

if not defined VIRTUAL_ENV (
    echo.
    echo [ERROR] VIRTUAL_ENV was not set after activation.
    exit /b 1
)

for %%A in ("%VIRTUAL_ENV%") do set "CURRENT_VENV=%%~fA"

if /I not "%CURRENT_VENV%"=="%EXPECTED_VENV%" (
    echo.
    echo [ERROR] Wrong virtual environment is active.
    echo.
    echo Expected:
    echo   %EXPECTED_VENV%
    echo.
    echo Active:
    echo   %CURRENT_VENV%
    exit /b 1
)

rem ----------------------------------------------------------------------------
rem VERIFY EXACT PYTHON
rem ----------------------------------------------------------------------------

"%PYTHON%" -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3,12) else 1)" >nul 2>&1

if errorlevel 1 (
    echo.
    echo [ERROR] Active backend venv does not use Python 3.12.
    exit /b 1
)

for /f "delims=" %%A in ('"%PYTHON%" -c "import sys; print(sys.executable)"') do set "ACTIVE_PYTHON=%%A"

for %%A in ("%ACTIVE_PYTHON%") do set "ACTIVE_PYTHON=%%~fA"
for %%A in ("%PYTHON%") do set "EXPECTED_PYTHON=%%~fA"

if /I not "%ACTIVE_PYTHON%"=="%EXPECTED_PYTHON%" (
    echo.
    echo [ERROR] Wrong Python interpreter is active.
    echo.
    echo Expected:
    echo   %EXPECTED_PYTHON%
    echo.
    echo Active:
    echo   %ACTIVE_PYTHON%
    exit /b 1
)

echo Backend virtual environment activated:
echo   %VIRTUAL_ENV%
echo.

exit /b 0


rem ============================================================================
rem ERROR
rem ============================================================================

:error

echo.
echo ============================================================
echo [ERROR] Development environment could not be started.
echo ============================================================
echo.

pause
exit /b 1
