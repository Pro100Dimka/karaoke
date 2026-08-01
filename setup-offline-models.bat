@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
set "PYTHON=%ROOT%backend\venv\Scripts\python.exe"
set "SONGAPP_MODELS_DIR=%ROOT%backend\models"
set "HF_HOME=%SONGAPP_MODELS_DIR%\huggingface"

if not exist "%PYTHON%" (
  echo [ERROR] Backend virtual environment was not found.
  exit /b 1
)

call "%ROOT%setup-game-engine.bat" || exit /b 1

echo Preparing the Demucs and Whisper Medium offline models. This can take several GB.
"%PYTHON%" -c "import os; from pathlib import Path; import whisper; from demucs.pretrained import get_model; root=Path(os.environ['SONGAPP_MODELS_DIR']); whisper.load_model('medium', download_root=str(root / 'whisper')); get_model('htdemucs_ft'); print('Offline models are ready.')"
if errorlevel 1 exit /b 1
