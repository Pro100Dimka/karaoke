@echo off
setlocal EnableExtensions

set "ROOT=%~dp0..\"
set "PYTHON=%ROOT%backend\venv\Scripts\python.exe"
set "SONGAPP_MODELS_DIR=%ROOT%backend\models"
set "HF_HOME=%SONGAPP_MODELS_DIR%\huggingface"
set "GAME_MODEL=%ROOT%backend\engines\game\models\GAME-1.0.3-large-onnx\config.json"
set "WHISPER_MODEL=%SONGAPP_MODELS_DIR%\whisper\medium.pt"
set "DEMUCS_MODEL=%HF_HOME%\hub\models--adefossez--HTDemucs-ft\refs\main"

if not exist "%PYTHON%" (
  echo [ERROR] Backend virtual environment was not found.
  exit /b 1
)

if exist "%GAME_MODEL%" if exist "%WHISPER_MODEL%" if exist "%DEMUCS_MODEL%" (
  echo Offline AI models are already installed.
  exit /b 0
)

echo Missing offline AI models. Downloading only the missing files...
call "%~dp0download-game-model.bat" || exit /b 1
"%PYTHON%" -c "import os; from pathlib import Path; import whisper; from demucs.pretrained import get_model; root=Path(os.environ['SONGAPP_MODELS_DIR']); whisper.load_model('medium', download_root=str(root / 'whisper')); get_model('htdemucs_ft'); print('Offline models are ready.')"
exit /b %ERRORLEVEL%
