@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem ============================================================
rem  A&D Voice - AI Core 2026
rem  Full runtime + offline model installer v6 v4
rem
rem  Put this file into:
rem      backend\scripts\install-ai-models.bat
rem
rem  It installs:
rem    - backend venv from downloads\runtimes\python312 (if needed)
rem    - CUDA PyTorch
rem    - backend + AI Core requirements
rem    - Qwen3-ASR-0.6B
rem    - Qwen3-ForcedAligner-0.6B
rem    - TorchFCPE bundled model
rem    - MSST inference through the shared backend runtime
rem    - Mel-Band RoFormer vocals checkpoint
rem    - persistent user environment variables
rem
rem  Safe to run repeatedly. Existing valid files are reused.
rem ============================================================

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "PROJECT_ROOT=%%~fI"
set "ROOT=%PROJECT_ROOT%\backend"
set "DOWNLOADS=%PROJECT_ROOT%\downloads"

set "RUNTIME_PYTHON=%DOWNLOADS%\runtimes\python312\python.exe"
set "VENV_DIR=%ROOT%\venv"
set "PYTHON=%VENV_DIR%\Scripts\python.exe"

set "MODELS_DIR=%DOWNLOADS%\models"
set "HF_HOME=%MODELS_DIR%\huggingface"
set "QWEN_DIR=%MODELS_DIR%\qwen"
set "QWEN_ASR_DIR=%QWEN_DIR%\Qwen3-ASR-0.6B"
set "QWEN_ALIGNER_DIR=%QWEN_DIR%\Qwen3-ForcedAligner-0.6B"

set "ENGINES_DIR=%DOWNLOADS%\engines"
set "MSST_DIR=%ENGINES_DIR%\msst"
set "MSST_PYTHON=%PYTHON%"
set "MSST_INFERENCE=%MSST_DIR%\inference.py"
set "MSST_CONFIG=%MSST_DIR%\configs\KimberleyJensen\config_vocals_mel_band_roformer_kj.yaml"

set "ROFORMER_DIR=%MODELS_DIR%\roformer"
set "MSST_CHECKPOINT=%ROFORMER_DIR%\MelBandRoformer.ckpt"
set "ROFORMER_SHA256=87201f4d31afb5bc79993230fc49446918425574db48c01c405e44f365c7559e"
set "ROFORMER_REPO=KimberleyJSN/melbandroformer"
set "ROFORMER_FILENAME=MelBandRoformer.ckpt"

rem Reproducible CUDA runtime.
set "TORCH_VERSION=2.8.0"
set "TORCHVISION_VERSION=0.23.0"
set "TORCHAUDIO_VERSION=2.8.0"
set "TORCH_INDEX=https://download.pytorch.org/whl/cu126"

rem Quiet pip output: hide "Requirement already satisfied" and package chatter.
rem Errors still make the command fail and our stage messages remain visible.
set "ADVOICE_PIP_FLAGS=--quiet --disable-pip-version-check --no-input"

rem pip treats PIP_QUIET as a special configuration environment variable.
rem Clear it in case it was inherited from a previous installer/terminal.
set "PIP_QUIET="
set "MSST_SETUPTOOLS_VERSION=80.9.0"

set "ENV_FILE=%DOWNLOADS%\ai-environment.bat"
set "TMP_ROOT=%TEMP%\advoice-ai-install"

title A^&D Voice - AI installation

rem Keep third-party deprecation chatter out of the installer UI.
set "PYTHONWARNINGS=ignore::DeprecationWarning"
set "HF_HUB_DISABLE_TELEMETRY=1"
set "TOKENIZERS_PARALLELISM=false"

echo.
echo ============================================================
echo  A^&D Voice - AI Core 2026 Installer
echo ============================================================
echo.
echo Backend:
echo   %ROOT%
echo.
echo Models:
echo   %MODELS_DIR%
echo.

rem ============================================================
rem 0. PREPARE
rem ============================================================

if not exist "%ROOT%\AI\requirements.txt" (
    echo [ERROR] AI\requirements.txt was not found.
    echo Expected:
    echo   %ROOT%\AI\requirements.txt
    goto :fail
)

if not exist "%ROOT%\requirements.txt" (
    echo [ERROR] backend requirements.txt was not found.
    goto :fail
)

if not exist "%RUNTIME_PYTHON%" if not exist "%PYTHON%" (
    echo [ERROR] Python 3.12 runtime was not found:
    echo   %RUNTIME_PYTHON%
    echo.
    echo And backend venv does not exist:
    echo   %PYTHON%
    goto :fail
)

if not exist "%MODELS_DIR%" mkdir "%MODELS_DIR%"
if not exist "%HF_HOME%" mkdir "%HF_HOME%"
if not exist "%QWEN_DIR%" mkdir "%QWEN_DIR%"
if not exist "%ROFORMER_DIR%" mkdir "%ROFORMER_DIR%"
if not exist "%ENGINES_DIR%" mkdir "%ENGINES_DIR%"

if exist "%TMP_ROOT%" rmdir /s /q "%TMP_ROOT%" >nul 2>&1
mkdir "%TMP_ROOT%" >nul 2>&1

rem ============================================================
rem 1. MAIN PYTHON VENV
rem ============================================================

echo [1/10] Preparing backend Python environment...

rem First verify the bundled Python 3.12 runtime itself.
if not exist "%RUNTIME_PYTHON%" (
    echo [ERROR] Bundled Python runtime was not found:
    echo   %RUNTIME_PYTHON%
    goto :fail
)

"%RUNTIME_PYTHON%" -c "import sys; print('Bundled Python:', sys.version); raise SystemExit(0 if sys.version_info[:2] == (3,12) else 3)"
if errorlevel 1 (
    echo.
    echo [ERROR] runtimes\python312\python.exe is not Python 3.12.
    echo Actual runtime:
    "%RUNTIME_PYTHON%" --version
    goto :fail
)

rem If an old venv exists, verify that it is really Python 3.12.
set "RECREATE_VENV=0"

if exist "%PYTHON%" (
    "%PYTHON%" -c "import sys; print('Existing venv Python:', sys.version); raise SystemExit(0 if sys.version_info[:2] == (3,12) else 4)"
    if errorlevel 1 (
        echo.
        echo Existing backend\venv uses the wrong Python version.
        echo It will be recreated from runtimes\python312.
        set "RECREATE_VENV=1"
    )
) else (
    set "RECREATE_VENV=1"
)

if "!RECREATE_VENV!"=="1" (
    if exist "%VENV_DIR%" (
        echo Removing old backend\venv...
        rmdir /s /q "%VENV_DIR%"
        if exist "%VENV_DIR%" (
            echo [ERROR] Could not remove:
            echo   %VENV_DIR%
            echo Close Python/backend processes and run again.
            goto :fail
        )
    )

    echo Creating backend\venv from runtimes\python312...
    "%RUNTIME_PYTHON%" -m venv "%VENV_DIR%"

    if errorlevel 1 (
        echo.
        echo [ERROR] Could not create backend venv using:
        echo   %RUNTIME_PYTHON%
        echo.
        echo If this is an embedded/portable Python without venv support,
        echo make sure Lib\venv exists in runtimes\python312.
        goto :fail
    )
)

if not exist "%PYTHON%" (
    echo [ERROR] Venv Python was not created:
    echo   %PYTHON%
    goto :fail
)

"%PYTHON%" -c "import sys; assert sys.version_info[:2] == (3,12), 'Python 3.12 is required'; print('Backend venv Python:', sys.version)"
if errorlevel 1 goto :fail

echo.
echo Updating pip...
"%PYTHON%" -m ensurepip --upgrade >nul 2>&1
"%PYTHON%" -m pip install %ADVOICE_PIP_FLAGS% --upgrade pip setuptools wheel
if errorlevel 1 goto :fail

rem ============================================================
rem 2. CUDA PYTORCH
rem ============================================================

echo.
echo [2/10] Installing CUDA PyTorch %TORCH_VERSION%...

"%PYTHON%" -m pip install %ADVOICE_PIP_FLAGS% --upgrade ^
    "torch==%TORCH_VERSION%" ^
    "torchvision==%TORCHVISION_VERSION%" ^
    "torchaudio==%TORCHAUDIO_VERSION%" ^
    --index-url "%TORCH_INDEX%"

if errorlevel 1 goto :fail

rem ============================================================
rem 3. BACKEND + AI DEPENDENCIES
rem ============================================================

echo.
echo [3/10] Installing backend and AI Core dependencies...

"%PYTHON%" -m pip install %ADVOICE_PIP_FLAGS% -r "%ROOT%\requirements.txt"
if errorlevel 1 goto :fail

"%PYTHON%" -m pip install %ADVOICE_PIP_FLAGS% --upgrade "huggingface_hub>=0.34,<1.0"
if errorlevel 1 goto :fail

echo Checking Transformers / Hugging Face compatibility...
"%PYTHON%" -c "import huggingface_hub, transformers; from packaging.version import Version; assert Version(huggingface_hub.__version__) < Version('1.0.0'), 'huggingface_hub must be < 1.0 for installed transformers'" >nul
if errorlevel 1 goto :fail
echo Hugging Face runtime: OK

rem Re-assert the CUDA build in case a dependency resolver replaced torch.
"%PYTHON%" -m pip install %ADVOICE_PIP_FLAGS% --upgrade ^
    "torch==%TORCH_VERSION%" ^
    "torchvision==%TORCHVISION_VERSION%" ^
    "torchaudio==%TORCHAUDIO_VERSION%" ^
    --index-url "%TORCH_INDEX%"

if errorlevel 1 goto :fail

rem ============================================================
rem 4. CUDA CHECK
rem ============================================================

echo.
echo [4/10] Checking NVIDIA CUDA...

"%PYTHON%" -c "import torch; print('Torch:', torch.__version__); print('CUDA runtime:', torch.version.cuda); print('CUDA available:', torch.cuda.is_available()); print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NOT AVAILABLE'); raise SystemExit(0 if torch.cuda.is_available() else 2)"
if errorlevel 1 (
    echo.
    echo [ERROR] PyTorch cannot see the NVIDIA GPU.
    echo.
    echo Update your NVIDIA driver and run this installer again.
    echo The RTX 3060 does not require a separately installed CUDA Toolkit
    echo when using the official PyTorch CUDA wheel.
    goto :fail
)

rem ============================================================
rem 5. QWEN ASR
rem ============================================================

echo.
echo [5/10] Installing Qwen3-ASR-0.6B locally...

set "HF_HOME=%HF_HOME%"
set "HF_HUB_CACHE=%HF_HOME%\hub"

if exist "%QWEN_ASR_DIR%\config.json" (
    echo Qwen3-ASR already exists. Verifying files...
) else (
    "%PYTHON%" -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='Qwen/Qwen3-ASR-0.6B', local_dir=r'%QWEN_ASR_DIR%'); print('Qwen3-ASR download complete.')"
    if errorlevel 1 goto :fail
)

"%PYTHON%" -c "from pathlib import Path; p=Path(r'%QWEN_ASR_DIR%'); assert (p/'config.json').is_file(), 'Qwen ASR config.json missing'; assert any(p.glob('*.safetensors')) or any(p.rglob('*.safetensors')), 'Qwen ASR model weights missing'; print('Qwen3-ASR: OK')"
if errorlevel 1 goto :fail

rem ============================================================
rem 6. QWEN FORCED ALIGNER
rem ============================================================

echo.
echo [6/10] Installing Qwen3 Forced Aligner locally...

if exist "%QWEN_ALIGNER_DIR%\config.json" (
    echo Qwen3 Forced Aligner already exists. Verifying files...
) else (
    "%PYTHON%" -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='Qwen/Qwen3-ForcedAligner-0.6B', local_dir=r'%QWEN_ALIGNER_DIR%'); print('Qwen3 Forced Aligner download complete.')"
    if errorlevel 1 goto :fail
)

"%PYTHON%" -c "from pathlib import Path; p=Path(r'%QWEN_ALIGNER_DIR%'); assert (p/'config.json').is_file(), 'Qwen aligner config.json missing'; assert any(p.glob('*.safetensors')) or any(p.rglob('*.safetensors')), 'Qwen aligner weights missing'; print('Qwen3 Forced Aligner: OK')"
if errorlevel 1 goto :fail

rem ============================================================
rem 7. FCPE
rem ============================================================

echo.
echo [7/10] Verifying TorchFCPE bundled model...

"%PYTHON%" -c "import torch, torchfcpe; d='cuda' if torch.cuda.is_available() else 'cpu'; m=torchfcpe.spawn_bundled_infer_model(device=d); print('TorchFCPE:', type(m).__name__, 'device=', d); del m"
if errorlevel 1 goto :fail

rem ============================================================
rem 8. MSST SOURCE
rem ============================================================

echo.
echo [8/10] Preparing MSST Mel-Band RoFormer engine...

if not exist "%MSST_INFERENCE%" (
    echo MSST repository is missing. Downloading...

    rem Remove only an incomplete installer-created MSST directory.
    if exist "%MSST_DIR%" (
        echo Removing incomplete MSST directory...
        rmdir /s /q "%MSST_DIR%"
    )

    where git >nul 2>&1
    if not errorlevel 1 (
        git clone --quiet --depth 1 ^
            https://github.com/ZFTurbo/Music-Source-Separation-Training.git ^
            "%MSST_DIR%"
        if errorlevel 1 goto :fail
    ) else (
        echo Git was not found. Using Windows download fallback...

        set "MSST_ZIP=%TMP_ROOT%\msst.zip"
        set "MSST_UNPACK=%TMP_ROOT%\msst-unpack"

        curl.exe -L --fail --retry 5 --retry-delay 3 --progress-bar ^
            -o "!MSST_ZIP!" ^
            "https://github.com/ZFTurbo/Music-Source-Separation-Training/archive/refs/heads/main.zip"

        if errorlevel 1 goto :fail

        powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
            "Expand-Archive -LiteralPath '!MSST_ZIP!' -DestinationPath '!MSST_UNPACK!' -Force"
        if errorlevel 1 goto :fail

        for /d %%D in ("!MSST_UNPACK!\Music-Source-Separation-Training-*") do (
            move "%%~fD" "%MSST_DIR%" >nul
        )
    )
)

if not exist "%MSST_INFERENCE%" (
    echo [ERROR] MSST inference.py was not installed.
    goto :fail
)

if not exist "%MSST_CONFIG%" (
    echo [ERROR] Required MSST Mel-Band RoFormer config is missing:
    echo   %MSST_CONFIG%
    echo.
    echo The expected current upstream config is:
    echo   configs\KimberleyJensen\config_vocals_mel_band_roformer_kj.yaml
    echo.
    echo MSST repository contents may have changed upstream.
    goto :fail
)

rem ============================================================
rem 9. SHARED MSST RUNTIME + CHECKPOINT
rem ============================================================

echo.
echo [9/10] Verifying shared MSST runtime...
echo MSST now uses backend\venv and the same PyTorch/CUDA libraries as AI Core.
echo No duplicate virtual environment or training dependencies are installed.

echo.
echo Checking Mel-Band RoFormer checkpoint...

set "CHECKPOINT_OK=0"

if exist "%MSST_CHECKPOINT%" (
    "%PYTHON%" -c "from pathlib import Path; import hashlib, sys; p=Path(r'%MSST_CHECKPOINT%'); expected=r'%ROFORMER_SHA256%'.lower(); h=hashlib.sha256(); f=p.open('rb'); [h.update(b) for b in iter(lambda:f.read(8*1024*1024), b'')]; f.close(); actual=h.hexdigest().lower(); print('RoFormer SHA-256:', actual); sys.exit(0 if actual==expected else 5)"
    if not errorlevel 1 (
        set "CHECKPOINT_OK=1"
    ) else (
        echo Existing checkpoint hash does not match the official model.
        echo It will be replaced.
    )
)

if "!CHECKPOINT_OK!"=="1" (
    echo RoFormer checkpoint already installed and SHA-256 is valid.
) else (
    echo Downloading Kimberley Jensen Mel-Band RoFormer checkpoint...

    set "HF_HOME=%HF_HOME%"
    set "HF_HUB_CACHE=%HF_HOME%\hub"

    "%PYTHON%" -c "from huggingface_hub import hf_hub_download; from pathlib import Path; p=hf_hub_download(repo_id=r'%ROFORMER_REPO%', filename=r'%ROFORMER_FILENAME%', local_dir=r'%ROFORMER_DIR%'); print('RoFormer downloaded:', p)"
    if errorlevel 1 goto :fail

    if not exist "%MSST_CHECKPOINT%" (
        echo [ERROR] RoFormer checkpoint was not created:
        echo   %MSST_CHECKPOINT%
        goto :fail
    )

    echo Verifying RoFormer SHA-256 with Python...

    "%PYTHON%" -c "from pathlib import Path; import hashlib, sys; p=Path(r'%MSST_CHECKPOINT%'); expected=r'%ROFORMER_SHA256%'.lower(); h=hashlib.sha256(); f=p.open('rb'); [h.update(b) for b in iter(lambda:f.read(8*1024*1024), b'')]; f.close(); actual=h.hexdigest().lower(); print('Expected:', expected); print('Actual:  ', actual); sys.exit(0 if actual==expected else 6)"
    if errorlevel 1 (
        echo.
        echo [ERROR] RoFormer SHA-256 verification failed.
        echo The downloaded file was kept for inspection and WILL NOT be deleted.
        goto :fail
    )

    echo RoFormer SHA-256: OK
)

"%MSST_PYTHON%" "%MSST_INFERENCE%" --help >nul 2>&1
if errorlevel 1 (
    echo [ERROR] MSST inference runtime test failed.
    goto :fail
)

rem ============================================================
rem 10. WRITE/PERSIST CONFIG + FINAL VERIFY
rem ============================================================

echo.
echo [10/10] Writing AI environment configuration...

(
    echo @echo off
    echo rem Generated by install-ai-models.bat
    echo set "HF_HOME=%HF_HOME%"
    echo set "HF_HUB_CACHE=%HF_HOME%\hub"
    echo set "KARAOKE_AI_ASR_MODEL=%QWEN_ASR_DIR%"
    echo set "KARAOKE_AI_ALIGNER_MODEL=%QWEN_ALIGNER_DIR%"
    echo set "KARAOKE_AI_ALLOW_FALLBACK=false"
    echo set "MSST_INFERENCE_COMMAND="%MSST_PYTHON%" "%MSST_INFERENCE%""
    echo set "MSST_CONFIG=%MSST_CONFIG%"
    echo set "MSST_CHECKPOINT=%MSST_CHECKPOINT%"
) > "%ENV_FILE%"

rem Apply paths only to this verification process. Runtime code resolves the
rem project-relative paths itself, so moving the project never leaves stale
rem machine-wide environment variables behind.
call "%ENV_FILE%"

echo.
echo Checking Python dependency consistency...

"%PYTHON%" -m pip check > "%TMP_ROOT%\pip-check-main.log" 2>&1
if errorlevel 1 (
    echo [ERROR] Main Python dependency conflicts detected:
    type "%TMP_ROOT%\pip-check-main.log"
    goto :fail
)

echo Dependencies: OK

echo.
echo Running final AI Core health check...

"%PYTHON%" -c "import os, torch; from AI.config import CoreConfig; from AI.service import AICoreService; c=CoreConfig.from_env(); s=AICoreService(c); h=s.health(); print('AI Core:', h); print('CUDA:', torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'); assert h['separation_configured'], 'RoFormer/MSST is not configured'; assert not h['fallback_enabled'], 'Production fallback must be disabled'"
if errorlevel 1 goto :fail

echo.
echo ============================================================
echo  AI INSTALLATION COMPLETE
echo ============================================================
echo.
echo Main Python:
echo   %PYTHON%
echo.
echo Qwen ASR:
echo   %QWEN_ASR_DIR%
echo.
echo Qwen Forced Aligner:
echo   %QWEN_ALIGNER_DIR%
echo.
echo RoFormer:
echo   %MSST_CHECKPOINT%
echo.
echo MSST:
echo   %MSST_DIR%
echo.
echo Environment file:
echo   %ENV_FILE%
echo.
echo Resources are stored under:
echo   %DOWNLOADS%
echo Runtime paths are resolved dynamically; no machine-wide variables
echo or absolute project paths are persisted.
echo.
goto :success

:fail
echo.
echo ============================================================
echo  AI INSTALLATION FAILED
echo ============================================================
echo.
echo Check the messages above.
echo Temporary installer files:
echo   %TMP_ROOT%
echo.
pause
exit /b 1

:success
if exist "%TMP_ROOT%" rmdir /s /q "%TMP_ROOT%" >nul 2>&1
exit /b 0
