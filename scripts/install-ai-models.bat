@echo off
setlocal EnableExtensions

if /i "%~1"=="--msst-worker" goto :msst_worker

title A^&D Voice - AI Core

rem ============================================================
rem CONFIG
rem ============================================================

if "%~1"=="" (
    for %%I in ("%~dp0..") do set "ROOT=%%~fI"
) else (
    for %%I in ("%~1") do set "ROOT=%%~fI"
)

set "BACK=%ROOT%\backend"
set "DL=%ROOT%\downloads"

set "PYRT=%DL%\runtimes\python312\tools\python.exe"

set "VENV=%BACK%\venv"
set "PY=%VENV%\Scripts\python.exe"

set "HF_HOME=%DL%\cache\huggingface"
set "HF_HUB_CACHE=%HF_HOME%\hub"

set "MSST=%DL%\engines\msst"
set "MSST_INF=%MSST%\inference.py"
set "MSST_CFG=%MSST%\configs\KimberleyJensen\config_vocals_mel_band_roformer_kj.yaml"

set "ENV=%DL%\ai-environment.bat"
set "TMP=%TEMP%\advoice-ai-install"

set "INSTALLER=%BACK%\AI\install_models.py"

rem Number of model downloads running at the same time.
set "WORKERS=4"

rem ============================================================
rem PYTORCH
rem ============================================================

set "TORCH=2.8.0"
set "TV=0.23.0"
set "TA=2.8.0"

set "TORCH_URL=https://download.pytorch.org/whl/cu126"

rem ============================================================
rem PIP
rem ============================================================

set "PIP=--quiet --disable-pip-version-check --no-input"

rem ============================================================
rem ENVIRONMENT
rem ============================================================

set "PYTHONWARNINGS=ignore::DeprecationWarning"
set "HF_HUB_DISABLE_TELEMETRY=1"
set "TOKENIZERS_PARALLELISM=false"

call :header

rem ============================================================
rem PROJECT CHECK
rem ============================================================

if not exist "%BACK%\" (
    echo [ERROR] Backend directory not found:
    echo   %BACK%
    goto :fail
)

for %%F in (
    "%BACK%\requirements.txt"
    "%BACK%\AI\requirements.txt"
    "%INSTALLER%"
    "%PYRT%"
) do (
    call :need "%%~F" || goto :fail
)

rem ============================================================
rem DIRECTORIES
rem ============================================================

if not exist "%DL%\" (
    mkdir "%DL%" >nul 2>&1 || goto :fail
)

if not exist "%HF_HOME%\" (
    mkdir "%HF_HOME%" >nul 2>&1 || goto :fail
)

if not exist "%DL%\engines\" (
    mkdir "%DL%\engines" >nul 2>&1 || goto :fail
)

rem ============================================================
rem OLD HUGGING FACE CACHE MIGRATION
rem ============================================================

if exist "%DL%\models\huggingface\" (
    echo Migrating Hugging Face cache...

    robocopy ^
        "%DL%\models\huggingface" ^
        "%HF_HOME%" ^
        /E ^
        /MOVE ^
        /R:2 ^
        /W:1 ^
        /NFL ^
        /NDL ^
        /NJH ^
        /NJS >nul

    if errorlevel 8 goto :fail

    if exist "%DL%\models\huggingface\" (
        rmdir /s /q "%DL%\models\huggingface" >nul 2>&1
    )
)

rem ============================================================
rem TEMP
rem ============================================================

if exist "%TMP%\" (
    rmdir /s /q "%TMP%" >nul 2>&1
)

mkdir "%TMP%" >nul 2>&1 || goto :fail

rem ============================================================
rem FAST CHECK
rem ============================================================

if exist "%PY%" (
    if exist "%MSST_INF%" (
        if exist "%MSST_CFG%" (

            call :py312 "%PY%" >nul 2>&1

            if not errorlevel 1 (

                set "OLD_PYTHONPATH=%PYTHONPATH%"
                set "PYTHONPATH=%BACK%;%PYTHONPATH%"

                "%PY%" "%INSTALLER%" ^
                    --downloads "%DL%" ^
                    --msst "%MSST%" ^
                    --env "%ENV%" ^
                    --check >nul 2>&1

                set "CHECK_RC=%ERRORLEVEL%"

                set "PYTHONPATH=%OLD_PYTHONPATH%"

                if "%CHECK_RC%"=="0" (

                    "%PY%" -c ^
                        "import qwen_asr,torch,torchfcpe,omegaconf,beartype,rotary_embedding_torch,hf_xet;raise SystemExit(not torch.cuda.is_available())" ^
                        >nul 2>&1

                    if not errorlevel 1 (

                        if exist "%ENV%" (
                            call "%ENV%" >nul 2>&1
                        )

                        if defined MSST_ENGINE_DIR (
                            if defined MSST_CONFIG (
                                if defined MSST_CHECKPOINT (

                                    if exist "%MSST_ENGINE_DIR%\" (
                                        if exist "%MSST_CONFIG%" (
                                            if exist "%MSST_CHECKPOINT%" (

                                                echo AI Core is ready.

                                                rmdir /s /q "%TMP%" >nul 2>&1

                                                exit /b 0
                                            )
                                        )
                                    )
                                )
                            )
                        )
                    )
                )
            )
        )
    )
)

rem ============================================================
rem INSTALL
rem ============================================================

echo Required AI resources are missing or incomplete.
echo Installing into:
echo   %DL%
echo.

rem ============================================================
rem 1. PYTHON / VENV
rem ============================================================

echo [1/7] Python 3.12...

call :py312 "%PYRT%" || (
    echo.
    echo [ERROR] Runtime is not Python 3.12:
    echo   %PYRT%
    goto :fail
)

if exist "%PY%" (

    call :py312 "%PY%" >nul 2>&1

    if not errorlevel 1 goto :venv_ok

    echo.
    echo Recreating backend virtual environment:
    echo   %VENV%

    rmdir /s /q "%VENV%" || goto :fail
)

echo.
echo Creating backend virtual environment:
echo   %VENV%
echo.

"%PYRT%" -m venv "%VENV%" || goto :fail

:venv_ok

call :need "%PY%" || goto :fail

"%PY%" -m ensurepip --upgrade >nul 2>&1

call :pip ^
    --upgrade ^
    pip ^
    setuptools ^
    wheel || goto :fail

rem ============================================================
rem 2. PYTORCH
rem ============================================================

echo.
echo [2/7] CUDA PyTorch...

call :torch || goto :fail

rem ============================================================
rem 3. DEPENDENCIES
rem ============================================================

echo.
echo [3/7] Dependencies...

call :pip ^
    -r "%BACK%\requirements.txt" ^
    -r "%BACK%\AI\requirements.txt" || goto :fail

rem ============================================================
rem HUGGING FACE + XET
rem ============================================================

echo.
echo Installing Hugging Face downloader...

call :pip ^
    --upgrade ^
    "huggingface_hub>=0.34,<1.0" ^
    "hf_xet" || goto :fail

"%PY%" -c ^
    "import huggingface_hub,hf_xet;from packaging.version import Version;print('HuggingFace:',huggingface_hub.__version__);print('hf_xet: OK');raise SystemExit(Version(huggingface_hub.__version__)>=Version('1.0'))" ^
    || goto :fail

rem Re-check PyTorch in case requirements changed it.

call :torch || goto :fail

rem ============================================================
rem 4. CUDA
rem ============================================================

echo.
echo [4/7] CUDA...

"%PY%" -c ^
    "import torch;ok=torch.cuda.is_available();print('Torch:',torch.__version__);print('CUDA:',torch.version.cuda);print('GPU:',torch.cuda.get_device_name(0) if ok else 'NOT AVAILABLE');raise SystemExit(not ok)" ^
    || goto :fail

rem ============================================================
rem 5. PARALLEL AI RESOURCES
rem ============================================================

echo.
echo [5/7] AI models + MSST in parallel...
echo Model workers:
echo   %WORKERS%
echo.

rem ============================================================
rem MSST BACKGROUND JOB
rem ============================================================

set "MSST_RC=%TMP%\msst.rc"
set "MSST_LOG=%TMP%\msst.log"

del /q "%MSST_RC%" >nul 2>&1
del /q "%MSST_LOG%" >nul 2>&1

if exist "%MSST_INF%" (

    >"%MSST_RC%" echo 0

) else (

    echo Starting MSST download in background...

    start "" /b cmd.exe /c call ^
        "%~f0" ^
        --msst-worker ^
        "%ROOT%" ^
        "%MSST_RC%" ^
        "%MSST_LOG%"
)

rem ============================================================
rem REGISTERED MODELS
rem ============================================================

set "OLD_PYTHONPATH=%PYTHONPATH%"
set "PYTHONPATH=%BACK%;%PYTHONPATH%"

"%PY%" "%INSTALLER%" ^
    --downloads "%DL%" ^
    --msst "%MSST%" ^
    --env "%ENV%" ^
    --workers %WORKERS%

set "MODEL_RC=%ERRORLEVEL%"

set "PYTHONPATH=%OLD_PYTHONPATH%"

if not "%MODEL_RC%"=="0" goto :fail

rem ============================================================
rem WAIT FOR MSST
rem ============================================================

echo.
echo Waiting for MSST...

call :wait "%MSST_RC%"

set "MSST_ERROR="

set /p MSST_ERROR=<"%MSST_RC%"

if not "%MSST_ERROR%"=="0" (

    echo.
    echo [ERROR] MSST installation failed.

    if exist "%MSST_LOG%" (
        echo.
        type "%MSST_LOG%"
    )

    goto :fail
)

call :need "%MSST_INF%" || goto :fail
call :need "%MSST_CFG%" || goto :fail

rem ============================================================
rem 6. ENGINE VERIFY
rem ============================================================

echo.
echo [6/7] AI engines verification...

"%PY%" -c ^
    "import torch,torchfcpe;d='cuda' if torch.cuda.is_available() else 'cpu';m=torchfcpe.spawn_bundled_infer_model(device=d);print('TorchFCPE:',type(m).__name__,d);del m" ^
    || goto :fail

"%PY%" "%MSST_INF%" --help >nul 2>&1 || (
    echo.
    echo [ERROR] MSST verification failed.
    goto :fail
)

rem Regenerate and verify model environment.

set "OLD_PYTHONPATH=%PYTHONPATH%"
set "PYTHONPATH=%BACK%;%PYTHONPATH%"

"%PY%" "%INSTALLER%" ^
    --downloads "%DL%" ^
    --msst "%MSST%" ^
    --env "%ENV%" ^
    --check

set "MODEL_CHECK_RC=%ERRORLEVEL%"

set "PYTHONPATH=%OLD_PYTHONPATH%"

if not "%MODEL_CHECK_RC%"=="0" goto :fail

rem ============================================================
rem 7. FINAL VERIFY
rem ============================================================

echo.
echo [7/7] Final verification...

"%PY%" -m pip check || goto :fail

rem ============================================================
rem LOAD GENERATED AI ENVIRONMENT
rem ============================================================

if not exist "%ENV%" (
    echo.
    echo [ERROR] AI environment file was not generated:
    echo   %ENV%
    goto :fail
)

call "%ENV%" || goto :fail

echo.
echo AI environment:
echo.

echo   HF_HOME=%HF_HOME%
echo   HF_HUB_CACHE=%HF_HUB_CACHE%

echo.
echo   MSST_ENGINE_DIR=%MSST_ENGINE_DIR%
echo   MSST_CONFIG=%MSST_CONFIG%
echo   MSST_CHECKPOINT=%MSST_CHECKPOINT%
echo.

rem ============================================================
rem VERIFY MSST ENVIRONMENT
rem ============================================================

if not defined MSST_ENGINE_DIR (
    echo [ERROR] MSST_ENGINE_DIR is not configured.
    goto :fail
)

if not defined MSST_CONFIG (
    echo [ERROR] MSST_CONFIG is not configured.
    goto :fail
)

if not defined MSST_CHECKPOINT (
    echo [ERROR] MSST_CHECKPOINT is not configured.
    goto :fail
)

call :need "%MSST_ENGINE_DIR%" || goto :fail
call :need "%MSST_CONFIG%" || goto :fail
call :need "%MSST_CHECKPOINT%" || goto :fail

rem ============================================================
rem BACKEND HEALTH CHECK
rem ============================================================

set "OLD_PYTHONPATH=%PYTHONPATH%"
set "PYTHONPATH=%BACK%;%PYTHONPATH%"

pushd "%BACK%" >nul 2>&1 || goto :fail

"%PY%" -c ^
    "import torch;from AI.config import CoreConfig;from AI.service import AICoreService;h=AICoreService(CoreConfig.from_env()).health();print('AI Core:',h);print('GPU:',torch.cuda.get_device_name(0));raise SystemExit(not(h['separation_configured'] and not h['fallback_enabled']))"

set "RC=%ERRORLEVEL%"

popd

set "PYTHONPATH=%OLD_PYTHONPATH%"

if not "%RC%"=="0" (
    echo.
    echo [ERROR] AI Core health check failed.
    goto :fail
)

rem ============================================================
rem SUCCESS
rem ============================================================

if exist "%TMP%\" (
    rmdir /s /q "%TMP%" >nul 2>&1
)

echo.
echo ============================================================
echo  AI INSTALLATION COMPLETE
echo ============================================================
echo.

echo Python:
echo   %PY%
echo.

echo Hugging Face cache:
echo   %HF_HOME%
echo.

echo MSST:
echo   %MSST%
echo.

echo AI environment:
echo   %ENV%
echo.

exit /b 0

rem ============================================================
rem HEADER
rem ============================================================

:header

echo.
echo ============================================================
echo  A^&D Voice - AI Core
echo ============================================================
echo.

echo Project:
echo   %ROOT%

echo.
echo Checking AI resources...
echo.

exit /b 0

rem ============================================================
rem FILE CHECK
rem ============================================================

:need

if exist "%~1" exit /b 0

echo.
echo [ERROR] Missing:
echo   %~1

exit /b 1

rem ============================================================
rem PYTHON VERSION
rem ============================================================

:py312

"%~1" -c ^
    "import sys;raise SystemExit(sys.version_info[:2]!=(3,12))"

exit /b %errorlevel%

rem ============================================================
rem PIP
rem ============================================================

:pip

"%PY%" -m pip install %PIP% %*

exit /b %errorlevel%

rem ============================================================
rem TORCH
rem ============================================================

:torch

call :pip ^
    --upgrade ^
    "torch==%TORCH%" ^
    "torchvision==%TV%" ^
    "torchaudio==%TA%" ^
    --index-url "%TORCH_URL%"

exit /b %errorlevel%

rem ============================================================
rem WAIT
rem ============================================================

:wait

if exist "%~1" exit /b 0

timeout /t 1 /nobreak >nul

goto :wait

rem ============================================================
rem MSST WORKER
rem ============================================================

:msst_worker

setlocal EnableExtensions

set "ROOT=%~2"
set "RC_FILE=%~3"
set "LOG_FILE=%~4"

set "DL=%ROOT%\downloads"

set "MSST=%DL%\engines\msst"
set "MSST_INF=%MSST%\inference.py"

set "TMP=%TEMP%\advoice-ai-install"

call :msst >"%LOG_FILE%" 2>&1

set "WORKER_RC=%ERRORLEVEL%"

>"%RC_FILE%" echo %WORKER_RC%

exit /b %WORKER_RC%

rem ============================================================
rem MSST INSTALL
rem ============================================================

:msst

echo Downloading MSST...

if exist "%MSST%\" (
    rmdir /s /q "%MSST%"
)

rem ============================================================
rem TRY GIT
rem ============================================================

where git.exe >nul 2>&1

if not errorlevel 1 (

    git clone ^
        --quiet ^
        --depth 1 ^
        https://github.com/ZFTurbo/Music-Source-Separation-Training.git ^
        "%MSST%"

    exit /b %errorlevel%
)

rem ============================================================
rem FALLBACK TO CURL
rem ============================================================

where curl.exe >nul 2>&1 || (
    echo.
    echo [ERROR] Neither git nor curl was found.
    exit /b 1
)

set "ZIP=%TMP%\msst.zip"
set "UNPACK=%TMP%\msst"

if exist "%ZIP%" (
    del /q "%ZIP%" >nul 2>&1
)

if exist "%UNPACK%\" (
    rmdir /s /q "%UNPACK%" >nul 2>&1
)

mkdir "%UNPACK%" >nul 2>&1 || exit /b 1

curl.exe ^
    -L ^
    --fail ^
    --retry 5 ^
    --retry-delay 3 ^
    --progress-bar ^
    -o "%ZIP%" ^
    "https://github.com/ZFTurbo/Music-Source-Separation-Training/archive/refs/heads/main.zip" ^
    || exit /b 1

powershell.exe ^
    -NoProfile ^
    -ExecutionPolicy Bypass ^
    -Command ^
    "Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%UNPACK%' -Force" ^
    || exit /b 1

for /d %%D in (
    "%UNPACK%\Music-Source-Separation-Training-*"
) do (
    move "%%~fD" "%MSST%" >nul
)

if exist "%MSST_INF%" (
    exit /b 0
)

echo.
echo [ERROR] MSST extraction failed.

exit /b 1

rem ============================================================
rem FAIL
rem ============================================================

:fail

echo.
echo ============================================================
echo  AI INSTALLATION FAILED
echo ============================================================
echo.

echo Check the error above.
echo.

rem IMPORTANT:
rem Do not use PAUSE here.
rem This script can run as a background worker from start-dev.bat.

exit /b 1