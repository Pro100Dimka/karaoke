@echo off
setlocal EnableExtensions

set "PROJECT_ROOT=%~dp0"
set "BACKEND_DIR=%PROJECT_ROOT%backend"
set "PYTHON=%BACKEND_DIR%\venv\Scripts\python.exe"

if not exist "%PYTHON%" (
  echo [ERROR] Backend virtual environment was not found: %PYTHON%
  echo Create it first and install backend requirements.
  exit /b 1
)

for %%F in (ffmpeg.exe) do set "FFMPEG_PATH=%%~$PATH:F"
if not defined FFMPEG_PATH (
  echo [ERROR] ffmpeg.exe was not found in PATH.
  echo Install FFmpeg or add its bin folder to PATH, then run this file again.
  exit /b 1
)

call "%PROJECT_ROOT%scripts\ensure-offline-models.bat"
if errorlevel 1 exit /b 1

echo [1/3] Installing the backend packager when needed...
"%PYTHON%" -m pip install pyinstaller
if errorlevel 1 exit /b 1

echo [2/3] Building KaraokeBackend.exe...
pushd "%BACKEND_DIR%"
"%PYTHON%" -m PyInstaller --noconfirm --clean --onedir --name KaraokeBackend --paths "%BACKEND_DIR%\AI" --add-data "%BACKEND_DIR%\AI;AI" --add-binary "%FFMPEG_PATH%;." --hidden-import run_all --collect-submodules app --collect-submodules src --collect-all demucs --collect-all whisper --collect-all torch --collect-all onnxruntime run.py
if errorlevel 1 (
  popd
  exit /b 1
)
popd

echo Adding offline AI models to the packaged backend...
robocopy "%BACKEND_DIR%\models" "%BACKEND_DIR%\dist\KaraokeBackend\_internal\models" /E /R:2 /W:1 /NFL /NDL /NJH /NJS
if errorlevel 8 exit /b 1
robocopy "%BACKEND_DIR%\engines\game\models\GAME-1.0.3-large-onnx" "%BACKEND_DIR%\dist\KaraokeBackend\_internal\models\game\GAME-1.0.3-large-onnx" /E /R:2 /W:1 /NFL /NDL /NJH /NJS
if errorlevel 8 exit /b 1

echo [3/3] Building the Windows installer...
pushd "%PROJECT_ROOT%front"
call npm run build:electron
set "BUILD_RESULT=%ERRORLEVEL%"
popd

if not "%BUILD_RESULT%"=="0" exit /b %BUILD_RESULT%
echo.
echo Done. Installer: %PROJECT_ROOT%front\release\Karaoke Studio Setup.exe
