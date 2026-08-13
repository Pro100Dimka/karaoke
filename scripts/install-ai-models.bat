@echo off
setlocal EnableExtensions
title A^&D Voice - AI Core

if "%~1"=="" (for %%I in ("%~dp0..") do set "ROOT=%%~fI") else for %%I in ("%~1") do set "ROOT=%%~fI"

set "BACK=%ROOT%\backend"
set "DL=%ROOT%\downloads"
set "PYRT=%DL%\runtimes\python312\tools\python.exe"
set "VENV=%BACK%\venv"
set "PY=%VENV%\Scripts\python.exe"
set "MODELS=%DL%\models"
set "HF_HOME=%DL%\cache\huggingface"
set "HF_HUB_CACHE=%HF_HOME%\hub"
set "MSST=%DL%\engines\msst"
set "MSST_INF=%MSST%\inference.py"
set "MSST_CFG=%MSST%\configs\KimberleyJensen\config_vocals_mel_band_roformer_kj.yaml"
set "ENV=%DL%\ai-environment.bat"
set "INSTALLER=%BACK%\AI\install_models.py"
set "STATE=%DL%\state"
set "STAMP=%STATE%\ai-ready.ok"

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

for %%F in ("%PYRT%" "%INSTALLER%") do (
    if not exist "%%~F" (
        echo [ERROR] Missing: %%~F
        goto :fail
    )
)

for %%D in ("%DL%" "%HF_HOME%" "%DL%\engines" "%STATE%") do (
    if not exist "%%~D\" mkdir "%%~D" >nul 2>&1 || goto :fail
)

rem ============================================================================
rem FAST PATH
rem ============================================================================
rem This intentionally avoids importing torch, CUDA, TorchFCPE and loading
rem any AI model. If the previous full verification succeeded and required
rem files still exist, startup is immediate.

if exist "%STAMP%" (
    call :quick
    if not errorlevel 1 (
        echo AI Core is ready. [cached]
        exit /b 0
    )
    echo AI cache is stale. Running repair...
    del /q "%STAMP%" >nul 2>&1
)

echo Required AI resources are missing or incomplete.
echo.

rem ============================================================================
rem PYTHON / VENV
rem ============================================================================

echo [1/7] Python 3.12...
call :py312 "%PYRT%" || goto :fail

if exist "%PY%" (
    call :py312 "%PY%" >nul 2>&1
    if not errorlevel 1 goto :venv_ok
    rmdir /s /q "%VENV%" >nul 2>&1 || goto :fail
)

"%PYRT%" -m venv "%VENV%" || goto :fail

:venv_ok
if not exist "%PY%" goto :fail

"%PY%" -m ensurepip --upgrade >nul 2>&1
call :pip --upgrade pip setuptools wheel || goto :fail

rem ============================================================================
rem TORCH
rem ============================================================================

echo [2/7] CUDA PyTorch...
"%PY%" -c "import torch;raise SystemExit(0 if torch.__version__.startswith('%TORCH%') else 1)" >nul 2>&1
if errorlevel 1 (
    call :pip --upgrade "torch==%TORCH%" "torchvision==%TV%" "torchaudio==%TA%" --index-url "%TORCH_URL%" || goto :fail
)

rem ============================================================================
rem DEPENDENCIES
rem ============================================================================

echo [3/7] Dependencies...
call :pip -r "%BACK%\requirements.txt" -r "%BACK%\AI\requirements.txt" || goto :fail
call :pip --upgrade "huggingface_hub>=0.34,<1.0" hf_xet || goto :fail

rem ============================================================================
rem CUDA
rem ============================================================================

echo [4/7] Compute backend...
"%PY%" -c "import torch;ok=torch.cuda.is_available();print('Torch:',torch.__version__);print('CUDA:',torch.version.cuda);print('Compute:',torch.cuda.get_device_name(0) if ok else 'CPU fallback')"
if errorlevel 1 goto :fail

rem ============================================================================
rem MODELS
rem ============================================================================

echo [5/7] AI models...
set "OLD_PYTHONPATH=%PYTHONPATH%"
set "PYTHONPATH=%BACK%;%PYTHONPATH%"

"%PY%" -m AI.install_models --downloads "%DL%" --msst "%MSST%" --env "%ENV%" --workers %WORKERS%
set "RC=%ERRORLEVEL%"

set "PYTHONPATH=%OLD_PYTHONPATH%"
if not "%RC%"=="0" goto :fail

rem ============================================================================
rem ENGINES
rem ============================================================================

echo [6/7] AI engines verification...
if not exist "%MSST_INF%" (
    echo [ERROR] MSST inference.py was not found:
    echo   %MSST_INF%
    goto :fail
)

if not exist "%MSST_CFG%" (
    echo [ERROR] MSST config was not found:
    echo   %MSST_CFG%
    goto :fail
)

"%PY%" -c "import torch,torchfcpe;d='cuda' if torch.cuda.is_available() else 'cpu';m=torchfcpe.spawn_bundled_infer_model(device=d);print('TorchFCPE:',type(m).__name__,d);del m"
if errorlevel 1 goto :fail

"%PY%" "%MSST_INF%" --help >nul 2>&1 || goto :fail

set "OLD_PYTHONPATH=%PYTHONPATH%"
set "PYTHONPATH=%BACK%;%PYTHONPATH%"

"%PY%" -m AI.install_models --downloads "%DL%" --msst "%MSST%" --env "%ENV%" --check
set "RC=%ERRORLEVEL%"

set "PYTHONPATH=%OLD_PYTHONPATH%"
if not "%RC%"=="0" goto :fail

rem ============================================================================
rem FINAL
rem ============================================================================

echo [7/7] Final verification...
"%PY%" -m pip check || goto :fail

call :quick
if errorlevel 1 goto :fail

>"%STAMP%" echo ready

echo.
echo ============================================================
echo  AI INSTALLATION COMPLETE
echo ============================================================
echo.
exit /b 0

rem ============================================================================
rem QUICK CHECK
rem ============================================================================

:quick
if not exist "%PY%" exit /b 1
if not exist "%PYRT%" exit /b 1
if not exist "%ENV%" exit /b 1
if not exist "%MSST_INF%" exit /b 1
if not exist "%MSST_CFG%" exit /b 1
if not exist "%MODELS%\" exit /b 1

call "%ENV%" >nul 2>&1

if not defined MSST_ENGINE_DIR set "MSST_ENGINE_DIR=%MSST%"
if not defined MSST_CONFIG set "MSST_CONFIG=%MSST_CFG%"

if not exist "%MSST_ENGINE_DIR%\" exit /b 1
if not exist "%MSST_CONFIG%" exit /b 1
if not defined MSST_CHECKPOINT exit /b 1
if not exist "%MSST_CHECKPOINT%" exit /b 1

"%PY%" -c "import sys,importlib.util;mods=('qwen_asr','omegaconf','beartype','rotary_embedding_torch');raise SystemExit(0 if sys.version_info[:2]==(3,12) and all(importlib.util.find_spec(x) for x in mods) else 1)" >nul 2>&1
exit /b %errorlevel%

:py312
"%~1" -c "import sys;raise SystemExit(0 if sys.version_info[:2]==(3,12) else 1)"
exit /b %errorlevel%

:pip
"%PY%" -m pip install %PIP% %*
exit /b %errorlevel%

:fail
del /q "%STAMP%" >nul 2>&1
echo.
echo ============================================================
echo  AI INSTALLATION FAILED
echo ============================================================
echo.
exit /b 1
