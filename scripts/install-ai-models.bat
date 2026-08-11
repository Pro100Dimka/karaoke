@echo off
setlocal EnableExtensions
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
set "RT=%DL%\runtimes\python312"
set "PYRT=%RT%\tools\python.exe"
set "VENV=%BACK%\venv"
set "PY=%VENV%\Scripts\python.exe"

set "MODELS=%DL%\models"
set "HF_HOME=%DL%\cache\huggingface"
set "HF_HUB_CACHE=%HF_HOME%\hub"

set "ASR=%MODELS%\qwen\Qwen3-ASR-1.7B"
set "ALIGN=%MODELS%\qwen\Qwen3-ForcedAligner-0.6B"
set "CTC_RU=%MODELS%\ctc\wav2vec2-large-xlsr-53-russian"
set "CTC_UK=%MODELS%\ctc\wav2vec2-xls-r-300m-uk"

set "MSST=%DL%\engines\msst"
set "MSST_INF=%MSST%\inference.py"
set "MSST_CFG=%MSST%\configs\KimberleyJensen\config_vocals_mel_band_roformer_kj.yaml"

set "ROF=%MODELS%\roformer"
set "ROF_FILE=%ROF%\MelBandRoformer.ckpt"
set "ROF_SHA=87201f4d31afb5bc79993230fc49446918425574db48c01c405e44f365c7559e"

set "TORCH=2.8.0"
set "TV=0.23.0"
set "TA=2.8.0"
set "TORCH_URL=https://download.pytorch.org/whl/cu126"

set "PIP=--quiet --disable-pip-version-check --no-input"
set "ENV=%DL%\ai-environment.bat"
set "TMP=%TEMP%\advoice-ai-install"

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
echo Checking AI resources...

rem ============================================================
rem PROJECT
rem ============================================================

if not exist "%BACK%\" (
    echo.
    echo [ERROR] Backend directory not found:
    echo   %BACK%
    goto :fail
)

if not exist "%DL%\" mkdir "%DL%" >nul 2>&1 || goto :fail

rem ============================================================
rem FAST CHECK
rem ============================================================

for %%F in (
    "%PY%"
    "%PYRT%"
    "%ASR%\config.json"
    "%ALIGN%\config.json"
    "%CTC_RU%\config.json"
    "%CTC_UK%\config.json"
    "%ROF_FILE%"
    "%MSST_INF%"
    "%MSST_CFG%"
) do if not exist "%%~F" goto :install

"%PY%" -c "from pathlib import Path;q=[Path(r'%ASR%'),Path(r'%ALIGN%')];c=[Path(r'%CTC_RU%'),Path(r'%CTC_UK%')];assert all(any(x.rglob('*.safetensors')) for x in q);assert all(any(x.rglob('*.safetensors')) or any(x.rglob('pytorch_model.bin')) for x in c);import qwen_asr,torch,torchfcpe,omegaconf,beartype,rotary_embedding_torch;assert torch.cuda.is_available()" >nul 2>&1 || goto :install

echo AI Core is ready.
exit /b 0

rem ============================================================
rem INSTALL
rem ============================================================

:install
echo Required AI resources are missing or incomplete.
echo Installing into:
echo   %DL%
echo.

for %%F in (
    "%BACK%\AI\requirements.txt"
    "%BACK%\requirements.txt"
    "%PYRT%"
) do call :need "%%~F" || goto :fail

for %%D in (
    "%MODELS%"
    "%DL%\cache"
    "%HF_HOME%"
    "%MODELS%\qwen"
    "%MODELS%\ctc"
    "%ROF%"
    "%DL%\engines"
) do if not exist "%%~D\" mkdir "%%~D" || goto :fail

rem ============================================================
rem CACHE
rem ============================================================

if exist "%MODELS%\huggingface\" (
    echo Migrating Hugging Face cache...

    robocopy "%MODELS%\huggingface" "%HF_HOME%" /E /MOVE /R:2 /W:1 /NFL /NDL /NJH /NJS >nul
    if errorlevel 8 goto :fail

    if exist "%MODELS%\huggingface\" rmdir /s /q "%MODELS%\huggingface" >nul 2>&1
)

if exist "%TMP%\" rmdir /s /q "%TMP%" >nul 2>&1
mkdir "%TMP%" >nul 2>&1 || goto :fail

rem ============================================================
rem 1. PYTHON
rem ============================================================

echo [1/10] Python 3.12...

call :py312 "%PYRT%" || (
    echo [ERROR] Runtime is not Python 3.12:
    echo   %PYRT%
    goto :fail
)

if exist "%PY%" (
    call :py312 "%PY%" && goto :venv_ok

    echo Existing backend venv uses wrong Python.
    echo Recreating:
    echo   %VENV%

    rmdir /s /q "%VENV%" || goto :fail
)

echo Creating backend virtual environment:
echo   %VENV%

"%PYRT%" -m venv "%VENV%" || goto :fail

:venv_ok
call :need "%PY%" || goto :fail

"%PY%" -m ensurepip --upgrade >nul 2>&1
call :pip --upgrade pip setuptools wheel || goto :fail

rem ============================================================
rem 2. PYTORCH
rem ============================================================

echo.
echo [2/10] CUDA PyTorch...
call :torch || goto :fail

rem ============================================================
rem 3. DEPENDENCIES
rem ============================================================

echo.
echo [3/10] Dependencies...

call :pip -r "%BACK%\requirements.txt" || goto :fail
call :pip -r "%BACK%\AI\requirements.txt" || goto :fail
call :pip --upgrade "huggingface_hub>=0.34,<1.0" || goto :fail

"%PY%" -c "import huggingface_hub;from packaging.version import Version;raise SystemExit(Version(huggingface_hub.__version__)>=Version('1.0'))" || goto :fail

call :torch || goto :fail

rem ============================================================
rem 4. CUDA
rem ============================================================

echo.
echo [4/10] CUDA...

"%PY%" -c "import torch;ok=torch.cuda.is_available();print('Torch:',torch.__version__);print('CUDA:',torch.version.cuda);print('GPU:',torch.cuda.get_device_name(0) if ok else 'NOT AVAILABLE');raise SystemExit(not ok)" || goto :fail

rem ============================================================
rem 5-6.5 MODELS
rem ============================================================

echo.
echo [5/10] Qwen3-ASR...
call :model "Qwen/Qwen3-ASR-1.7B" "%ASR%" qwen || goto :fail

echo.
echo [6/10] Qwen3 Forced Aligner...
call :model "Qwen/Qwen3-ForcedAligner-0.6B" "%ALIGN%" qwen || goto :fail

echo.
echo [6.5/10] CTC aligners...
call :model "jonatasgrosman/wav2vec2-large-xlsr-53-russian" "%CTC_RU%" ctc || goto :fail
call :model "Yehor/wav2vec2-xls-r-300m-uk-with-small-lm" "%CTC_UK%" ctc || goto :fail

rem ============================================================
rem 7. TORCHFCPE
rem ============================================================

echo.
echo [7/10] TorchFCPE...

"%PY%" -c "import torch,torchfcpe;d='cuda' if torch.cuda.is_available() else 'cpu';m=torchfcpe.spawn_bundled_infer_model(device=d);print('TorchFCPE:',type(m).__name__,d);del m" || goto :fail

rem ============================================================
rem 8. MSST
rem ============================================================

echo.
echo [8/10] MSST...

if not exist "%MSST_INF%" call :msst || goto :fail

call :need "%MSST_INF%" || goto :fail
call :need "%MSST_CFG%" || goto :fail

rem ============================================================
rem 9. ROFORMER
rem ============================================================

echo.
echo [9/10] Mel-Band RoFormer...

call :hash >nul 2>&1
if errorlevel 1 (
    echo Downloading checkpoint...

    "%PY%" -c "from huggingface_hub import hf_hub_download;hf_hub_download(repo_id='KimberleyJSN/melbandroformer',filename='MelBandRoformer.ckpt',local_dir=r'%ROF%')" || goto :fail

    call :hash || goto :fail
)

"%PY%" "%MSST_INF%" --help >nul 2>&1 || (
    echo [ERROR] MSST verification failed.
    goto :fail
)

rem ============================================================
rem 10. ENVIRONMENT
rem ============================================================

echo.
echo [10/10] Final verification...

> "%ENV%" (
    echo @echo off
    echo set "HF_HOME=%HF_HOME%"
    echo set "HF_HUB_CACHE=%HF_HUB_CACHE%"
    echo set "KARAOKE_AI_ASR_MODEL=%ASR%"
    echo set "KARAOKE_AI_ALIGNER_MODEL=%ALIGN%"
    echo set "KARAOKE_AI_CTC_RU_MODEL=%CTC_RU%"
    echo set "KARAOKE_AI_CTC_UK_MODEL=%CTC_UK%"
    echo set "KARAOKE_AI_ALLOW_FALLBACK=false"
    echo set "MSST_ENGINE_DIR=%MSST%"
    echo set "MSST_CONFIG=%MSST_CFG%"
    echo set "MSST_CHECKPOINT=%ROF_FILE%"
)

"%PY%" -m pip check || goto :fail

set "OLD_PYTHONPATH=%PYTHONPATH%"
set "PYTHONPATH=%BACK%;%PYTHONPATH%"

pushd "%BACK%" >nul 2>&1 || goto :fail

"%PY%" -c "import torch;from AI.config import CoreConfig;from AI.service import AICoreService;h=AICoreService(CoreConfig.from_env()).health();print('AI Core:',h);print('GPU:',torch.cuda.get_device_name(0));raise SystemExit(not(h['separation_configured'] and not h['fallback_enabled']))"

set "RC=%ERRORLEVEL%"
popd

set "PYTHONPATH=%OLD_PYTHONPATH%"

if not "%RC%"=="0" goto :fail

echo.
echo ============================================================
echo  AI INSTALLATION COMPLETE
echo ============================================================
echo.
echo Python:
echo   %PY%
echo.
echo Models:
echo   %MODELS%
echo.
echo MSST:
echo   %MSST%
echo.
echo Config:
echo   %ENV%
echo.

if exist "%TMP%\" rmdir /s /q "%TMP%" >nul 2>&1
exit /b 0

rem ============================================================
rem HELPERS
rem ============================================================

:need
if exist "%~1" exit /b 0
echo [ERROR] Missing:
echo   %~1
exit /b 1

:py312
"%~1" -c "import sys;raise SystemExit(sys.version_info[:2]!=(3,12))"
exit /b %errorlevel%

:pip
"%PY%" -m pip install %PIP% %*
exit /b %errorlevel%

:torch
call :pip --upgrade ^
    "torch==%TORCH%" ^
    "torchvision==%TV%" ^
    "torchaudio==%TA%" ^
    --index-url "%TORCH_URL%"
exit /b %errorlevel%

:model
setlocal
set "REPO=%~1"
set "DIR=%~2"
set "TYPE=%~3"

if not exist "%DIR%\config.json" (
    echo Downloading:
    echo   %REPO%

    "%PY%" -c "from huggingface_hub import snapshot_download;snapshot_download(repo_id=r'%REPO%',local_dir=r'%DIR%')" || (
        endlocal
        exit /b 1
    )
)

if /i "%TYPE%"=="qwen" (
    "%PY%" -c "from pathlib import Path;p=Path(r'%DIR%');assert (p/'config.json').is_file() and any(p.rglob('*.safetensors'))"
) else (
    "%PY%" -c "from pathlib import Path;p=Path(r'%DIR%');assert (p/'config.json').is_file() and (any(p.rglob('*.safetensors')) or any(p.rglob('pytorch_model.bin')))"
)

set "RC=%ERRORLEVEL%"
endlocal & exit /b %RC%

:hash
"%PY%" -c "from pathlib import Path;import hashlib;p=Path(r'%ROF_FILE%');assert p.is_file();h=hashlib.sha256();f=p.open('rb');[h.update(x) for x in iter(lambda:f.read(8388608),b'')];f.close();raise SystemExit(h.hexdigest().lower()!=r'%ROF_SHA%')"
exit /b %errorlevel%

:msst
echo Downloading MSST...

if exist "%MSST%\" rmdir /s /q "%MSST%"

where git.exe >nul 2>&1
if not errorlevel 1 (
    git clone --quiet --depth 1 ^
        https://github.com/ZFTurbo/Music-Source-Separation-Training.git ^
        "%MSST%"
    exit /b %errorlevel%
)

where curl.exe >nul 2>&1 || (
    echo [ERROR] Neither git nor curl was found.
    exit /b 1
)

set "ZIP=%TMP%\msst.zip"
set "UNPACK=%TMP%\msst"

if exist "%ZIP%" del /q "%ZIP%" >nul 2>&1
if exist "%UNPACK%\" rmdir /s /q "%UNPACK%" >nul 2>&1

mkdir "%UNPACK%" >nul 2>&1 || exit /b 1

curl.exe -L --fail --retry 5 --retry-delay 3 --progress-bar ^
    -o "%ZIP%" ^
    "https://github.com/ZFTurbo/Music-Source-Separation-Training/archive/refs/heads/main.zip" || exit /b 1

powershell.exe -NoProfile -ExecutionPolicy Bypass ^
    -Command "Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%UNPACK%' -Force" || exit /b 1

for /d %%D in ("%UNPACK%\Music-Source-Separation-Training-*") do move "%%~fD" "%MSST%" >nul

if exist "%MSST_INF%" exit /b 0

echo [ERROR] MSST extraction failed.
exit /b 1

:fail
echo.
echo ============================================================
echo  AI INSTALLATION FAILED
echo ============================================================
echo.
echo Check the error above.
echo.
pause
exit /b 1