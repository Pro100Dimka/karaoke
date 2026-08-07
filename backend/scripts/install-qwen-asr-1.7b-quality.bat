@echo off
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "ROOT=%%~fI"
set "PYTHON=%ROOT%\venv\Scripts\python.exe"
set "MODELS=%ROOT%\models"
set "HF_HOME=%MODELS%\huggingface"
set "MODEL_DIR=%MODELS%\qwen\Qwen3-ASR-1.7B"

if not exist "%PYTHON%" (
  echo [ERROR] Backend Python was not found: %PYTHON%
  exit /b 1
)

if not exist "%MODEL_DIR%" mkdir "%MODEL_DIR%"
set "HF_HOME=%HF_HOME%"
set "HF_HUB_CACHE=%HF_HOME%\hub"

echo.
echo ============================================================
echo  A^&D Voice - Qwen3-ASR 1.7B quality upgrade
echo ============================================================
echo.

if exist "%MODEL_DIR%\config.json" (
  echo Qwen3-ASR-1.7B already exists. Verifying...
) else (
  echo Downloading Qwen3-ASR-1.7B...
  "%PYTHON%" -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='Qwen/Qwen3-ASR-1.7B', local_dir=r'%MODEL_DIR%'); print('Download complete.')"
  if errorlevel 1 exit /b 1
)

"%PYTHON%" -c "from pathlib import Path; p=Path(r'%MODEL_DIR%'); assert (p/'config.json').is_file(); assert any(p.rglob('*.safetensors')); print('Qwen3-ASR-1.7B: OK')"
if errorlevel 1 exit /b 1

set "ADVOICE_QWEN_17=%MODEL_DIR%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "[Environment]::SetEnvironmentVariable('KARAOKE_AI_ASR_MODEL', $env:ADVOICE_QWEN_17, 'User')"
if errorlevel 1 exit /b 1

echo.
echo Quality ASR enabled:
echo   %MODEL_DIR%
echo.
echo Restart A^&D Voice completely before processing a song.
exit /b 0
