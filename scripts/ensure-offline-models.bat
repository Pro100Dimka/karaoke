@echo off
setlocal EnableExtensions

set "ROOT=%~dp0.."
set "PYTHON=%ROOT%\backend\venv\Scripts\python.exe"
set "DOWNLOADS=%ROOT%\downloads"
set "MODELS=%DOWNLOADS%\models"
set "ASR=%MODELS%\qwen\Qwen3-ASR-0.6B"
set "ALIGNER=%MODELS%\qwen\Qwen3-ForcedAligner-0.6B"
set "ROFORMER=%MODELS%\roformer\MelBandRoformer.ckpt"
set "MSST=%DOWNLOADS%\engines\msst\inference.py"
set "MSST_CONFIG=%DOWNLOADS%\engines\msst\configs\KimberleyJensen\config_vocals_mel_band_roformer_kj.yaml"

if not exist "%PYTHON%" goto :install
if not exist "%ASR%\config.json" goto :install
if not exist "%ALIGNER%\config.json" goto :install
if not exist "%ROFORMER%" goto :install
if not exist "%MSST%" goto :install
if not exist "%MSST_CONFIG%" goto :install

"%PYTHON%" -c "from pathlib import Path; roots=[Path(r'%ASR%'),Path(r'%ALIGNER%')]; assert all(any(p.rglob('*.safetensors')) for p in roots); import qwen_asr, torchfcpe, omegaconf, beartype, rotary_embedding_torch; print('Offline AI resources: OK')"
if not errorlevel 1 exit /b 0

:install
echo Required AI resources are missing or incomplete.
echo Installing them into:
echo   %DOWNLOADS%
call "%~dp0install-ai-models.bat"
exit /b %ERRORLEVEL%
