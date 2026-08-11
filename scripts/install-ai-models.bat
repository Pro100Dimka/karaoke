@echo off
setlocal EnableExtensions
if /i "%~1"=="--msst-worker" goto :msst_worker
title A^&D Voice - AI Core

if "%~1"=="" (for %%I in ("%~dp0..") do set "ROOT=%%~fI") else for %%I in ("%~1") do set "ROOT=%%~fI"

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
set "WORKERS=4"
set "TORCH=2.8.0"
set "TV=0.23.0"
set "TA=2.8.0"
set "TORCH_URL=https://download.pytorch.org/whl/cu126"
set "PIP=--quiet --disable-pip-version-check --no-input"
set "PYTHONWARNINGS=ignore::DeprecationWarning"
set "HF_HUB_DISABLE_TELEMETRY=1"
set "TOKENIZERS_PARALLELISM=false"

echo.
echo ============================================================
echo  A^&D Voice - AI Core
echo ============================================================
echo.
echo Project:
echo   %ROOT%
echo.

for %%F in ("%BACK%\requirements.txt" "%BACK%\AI\requirements.txt" "%INSTALLER%" "%PYRT%") do call :need "%%~F" || goto :fail
for %%D in ("%DL%" "%HF_HOME%" "%DL%\engines") do if not exist "%%~D\" mkdir "%%~D" >nul 2>&1 || goto :fail

rmdir /s /q "%TMP%" >nul 2>&1
mkdir "%TMP%" >nul 2>&1 || goto :fail

rem ============================================================================
rem FAST CHECK
rem ============================================================================

if exist "%PY%" if exist "%MSST_INF%" if exist "%MSST_CFG%" (
    call :py312 "%PY%" >nul 2>&1
    if not errorlevel 1 (
        call :env >nul 2>&1
        if not errorlevel 1 (
            set "OLD_PYTHONPATH=%PYTHONPATH%"
            set "PYTHONPATH=%BACK%;%PYTHONPATH%"
            "%PY%" "%INSTALLER%" --downloads "%DL%" --msst "%MSST%" --env "%ENV%" --check >nul 2>&1
            set "RC=%ERRORLEVEL%"
            set "PYTHONPATH=%OLD_PYTHONPATH%"
            if "%RC%"=="0" (
                "%PY%" -c "import torch,torchfcpe,qwen_asr;raise SystemExit(0 if torch.cuda.is_available() else 1)" >nul 2>&1
                if not errorlevel 1 (
                    echo AI Core is ready.
                    rmdir /s /q "%TMP%" >nul 2>&1
                    exit /b 0
                )
            )
        )
    )
)

echo Required AI resources are missing or incomplete.
echo.

rem ============================================================================
rem 1/7 PYTHON
rem ============================================================================

echo [1/7] Python 3.12...
call :py312 "%PYRT%" || goto :fail

if exist "%PY%" (
    call :py312 "%PY%" >nul 2>&1
    if not errorlevel 1 goto :venv_ok
    echo Recreating backend virtual environment...
    rmdir /s /q "%VENV%" || goto :fail
)

"%PYRT%" -m venv "%VENV%" || goto :fail

:venv_ok
call :need "%PY%" || goto :fail

rem Remove stale directories left by interrupted torch/pip updates.
for /d %%D in ("%VENV%\Lib\site-packages\~orch*" "%VENV%\Lib\site-packages\~unctorch*") do rmdir /s /q "%%~fD" >nul 2>&1

"%PY%" -m ensurepip --upgrade >nul 2>&1
call :pip --upgrade pip setuptools wheel || goto :fail

rem ============================================================================
rem 2/7 TORCH
rem ============================================================================

echo.
echo [2/7] CUDA PyTorch...
call :torch || goto :fail

rem ============================================================================
rem 3/7 DEPENDENCIES
rem ============================================================================

echo.
echo [3/7] Dependencies...

call :pip -r "%BACK%\requirements.txt" -r "%BACK%\AI\requirements.txt" || goto :fail
call :pip --upgrade "huggingface_hub>=0.34,<1.0" hf_xet || goto :fail

"%PY%" -c "import huggingface_hub,hf_xet;from packaging.version import Version;v=Version(huggingface_hub.__version__);print('HuggingFace:',v);print('hf_xet: OK');raise SystemExit(0 if v<Version('1.0') else 1)"
if errorlevel 1 goto :fail

call :torch || goto :fail

rem ============================================================================
rem 4/7 CUDA
rem ============================================================================

echo.
echo [4/7] CUDA...

"%PY%" -c "import torch;ok=torch.cuda.is_available();print('Torch:',torch.__version__);print('CUDA:',torch.version.cuda);print('GPU:',torch.cuda.get_device_name(0) if ok else 'NOT AVAILABLE');raise SystemExit(0 if ok else 1)"
if errorlevel 1 goto :fail

rem ============================================================================
rem 5/7 MODELS + MSST
rem ============================================================================

echo.
echo [5/7] AI models + MSST in parallel...
echo Model workers: %WORKERS%
echo.

set "MSST_RC=%TMP%\msst.rc"
set "MSST_LOG=%TMP%\msst.log"
del /q "%MSST_RC%" "%MSST_LOG%" >nul 2>&1

if exist "%MSST_INF%" (
    >"%MSST_RC%" echo 0
) else (
    start "" /b cmd.exe /c call "%~f0" --msst-worker "%ROOT%" "%MSST_RC%" "%MSST_LOG%"
)

set "OLD_PYTHONPATH=%PYTHONPATH%"
set "PYTHONPATH=%BACK%;%PYTHONPATH%"

"%PY%" "%INSTALLER%" --downloads "%DL%" --msst "%MSST%" --env "%ENV%" --workers %WORKERS%
set "RC=%ERRORLEVEL%"

set "PYTHONPATH=%OLD_PYTHONPATH%"
if not "%RC%"=="0" goto :fail

call :wait "%MSST_RC%"

set "RC="
set /p RC=<"%MSST_RC%"

if not "%RC%"=="0" (
    echo [ERROR] MSST installation failed.
    if exist "%MSST_LOG%" type "%MSST_LOG%"
    goto :fail
)

call :need "%MSST_INF%" || goto :fail
call :need "%MSST_CFG%" || goto :fail

rem ============================================================================
rem 6/7 VERIFY
rem ============================================================================

echo.
echo [6/7] AI engines verification...

"%PY%" -c "import torch,torchfcpe;d='cuda' if torch.cuda.is_available() else 'cpu';m=torchfcpe.spawn_bundled_infer_model(device=d);print('TorchFCPE:',type(m).__name__,d);del m"
if errorlevel 1 goto :fail

"%PY%" "%MSST_INF%" --help >nul 2>&1 || goto :fail

set "OLD_PYTHONPATH=%PYTHONPATH%"
set "PYTHONPATH=%BACK%;%PYTHONPATH%"

"%PY%" "%INSTALLER%" --downloads "%DL%" --msst "%MSST%" --env "%ENV%" --check
set "RC=%ERRORLEVEL%"

set "PYTHONPATH=%OLD_PYTHONPATH%"
if not "%RC%"=="0" goto :fail

rem ============================================================================
rem 7/7 FINAL
rem ============================================================================

echo.
echo [7/7] Final verification...

"%PY%" -m pip check || goto :fail

call :env || goto :fail

echo.
echo AI environment:
echo   MSST_ENGINE_DIR=%MSST_ENGINE_DIR%
echo   MSST_CONFIG=%MSST_CONFIG%
echo   MSST_CHECKPOINT=%MSST_CHECKPOINT%
echo.

set "OLD_PYTHONPATH=%PYTHONPATH%"
set "PYTHONPATH=%BACK%;%PYTHONPATH%"

pushd "%BACK%" >nul 2>&1 || goto :fail

"%PY%" -c "import torch;from AI.config import CoreConfig;from AI.service import AICoreService;h=AICoreService(CoreConfig.from_env()).health();print('AI Core:',h);print('GPU:',torch.cuda.get_device_name(0));ok=h['separation_configured'] and not h['fallback_enabled'];raise SystemExit(0 if ok else 1)"

set "RC=%ERRORLEVEL%"
popd

set "PYTHONPATH=%OLD_PYTHONPATH%"
if not "%RC%"=="0" goto :fail

rmdir /s /q "%TMP%" >nul 2>&1

echo.
echo ============================================================
echo  AI INSTALLATION COMPLETE
echo ============================================================
echo.

exit /b 0

rem ============================================================================
rem BUILD/REPAIR AI ENVIRONMENT
rem ============================================================================

:env

if exist "%ENV%" call "%ENV%" >nul 2>&1

if not defined MSST_ENGINE_DIR set "MSST_ENGINE_DIR=%MSST%"
if not defined MSST_CONFIG set "MSST_CONFIG=%MSST_CFG%"

if not defined MSST_CHECKPOINT (
    for /f "usebackq delims=" %%F in (`powershell.exe -NoProfile -Command ^
        "$f=Get-ChildItem -LiteralPath '%DL%\models' -Recurse -File -Filter '*.ckpt' -ErrorAction SilentlyContinue|Where-Object{$_.Name -match 'Mel.*Band.*Roformer|Roformer'}|Select-Object -First 1;if($f){$f.FullName}"`) do set "MSST_CHECKPOINT=%%F"
)

if not defined MSST_CHECKPOINT (
    for /f "usebackq delims=" %%F in (`powershell.exe -NoProfile -Command ^
        "$f=Get-ChildItem -LiteralPath '%DL%\models' -Recurse -File -Filter '*.ckpt' -ErrorAction SilentlyContinue|Select-Object -First 1;if($f){$f.FullName}"`) do set "MSST_CHECKPOINT=%%F"
)

call :need "%MSST_ENGINE_DIR%" || exit /b 1
call :need "%MSST_CONFIG%" || exit /b 1
call :need "%MSST_CHECKPOINT%" || exit /b 1

> "%ENV%" (
    echo @echo off
    echo set "HF_HOME=%HF_HOME%"
    echo set "HF_HUB_CACHE=%HF_HUB_CACHE%"
    echo set "MSST_ENGINE_DIR=%MSST_ENGINE_DIR%"
    echo set "MSST_CONFIG=%MSST_CONFIG%"
    echo set "MSST_CHECKPOINT=%MSST_CHECKPOINT%"
    echo set "KARAOKE_AI_ALLOW_FALLBACK=false"
)

exit /b 0

rem ============================================================================
rem HELPERS
rem ============================================================================

:need
if exist "%~1" exit /b 0
echo [ERROR] Missing:
echo   %~1
exit /b 1

:py312
"%~1" -c "import sys;raise SystemExit(0 if sys.version_info[:2]==(3,12) else 1)"
exit /b %errorlevel%

:pip
"%PY%" -m pip install %PIP% %*
exit /b %errorlevel%

:torch
call :pip --upgrade "torch==%TORCH%" "torchvision==%TV%" "torchaudio==%TA%" --index-url "%TORCH_URL%"
exit /b %errorlevel%

:wait
if exist "%~1" exit /b 0
timeout /t 1 /nobreak >nul
goto :wait

rem ============================================================================
rem MSST WORKER
rem ============================================================================

:msst_worker
setlocal EnableExtensions
set "ROOT=%~2"
set "RC=%~3"
set "LOG=%~4"
set "DL=%ROOT%\downloads"
set "MSST=%DL%\engines\msst"
set "MSST_INF=%MSST%\inference.py"
set "TMP=%TEMP%\advoice-ai-install"

call :msst >"%LOG%" 2>&1
set "ERR=%ERRORLEVEL%"
>"%RC%" echo %ERR%
exit /b %ERR%

:msst
echo Downloading MSST...

rmdir /s /q "%MSST%" >nul 2>&1
where git.exe >nul 2>&1

if not errorlevel 1 (
    git clone --quiet --depth 1 https://github.com/ZFTurbo/Music-Source-Separation-Training.git "%MSST%"
    exit /b %errorlevel%
)

where curl.exe >nul 2>&1 || exit /b 1

set "ZIP=%TMP%\msst.zip"
set "UNPACK=%TMP%\msst"

del /q "%ZIP%" >nul 2>&1
rmdir /s /q "%UNPACK%" >nul 2>&1
mkdir "%UNPACK%" >nul 2>&1 || exit /b 1

curl.exe -L --fail --retry 5 --retry-delay 3 --progress-bar ^
    -o "%ZIP%" ^
    "https://github.com/ZFTurbo/Music-Source-Separation-Training/archive/refs/heads/main.zip"

if errorlevel 1 exit /b 1

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
"Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%UNPACK%' -Force"

if errorlevel 1 exit /b 1

for /d %%D in ("%UNPACK%\Music-Source-Separation-Training-*") do move "%%~fD" "%MSST%" >nul

if exist "%MSST_INF%" exit /b 0
exit /b 1

:fail
echo.
echo ============================================================
echo  AI INSTALLATION FAILED
echo ============================================================
echo.
exit /b 1