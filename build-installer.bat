@echo off
setlocal EnableExtensions

set "PROJECT_ROOT=%~dp0"
set "BACKEND_DIR=%PROJECT_ROOT%backend"
set "PYTHON=%BACKEND_DIR%\venv\Scripts\python.exe"
set "ASIO_DIR=%BACKEND_DIR%\engines\asio"
set "VCVARS64=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
set "CMAKE_EXE=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
set "NINJA_EXE=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe"

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

echo [2/3] Building KaraokeBackend.exe and isolated audio monitor...
pushd "%BACKEND_DIR%"
"%PYTHON%" -m PyInstaller --noconfirm --clean --onedir --name KaraokeBackend --paths "%BACKEND_DIR%\AI" --add-data "%BACKEND_DIR%\AI;AI" --add-binary "%FFMPEG_PATH%;." --hidden-import run_all --collect-submodules app --collect-submodules src --collect-all demucs --collect-all whisper --collect-all torch --collect-all onnxruntime run.py
if errorlevel 1 (
  popd
  exit /b 1
)
"%PYTHON%" -m PyInstaller --noconfirm --clean --onefile --name KaraokeAudioMonitor --distpath "%BACKEND_DIR%\dist\KaraokeBackend" --workpath "%BACKEND_DIR%\build-audio-monitor" --specpath "%BACKEND_DIR%\build-audio-monitor" --paths "%BACKEND_DIR%" --collect-submodules app app\services\monitor_worker.py
if errorlevel 1 (
  popd
  exit /b 1
)
popd

if not exist "%VCVARS64%" (
  echo [ERROR] Visual C++ Build Tools were not found. Install them before building the ASIO bridge.
  exit /b 1
)
if not exist "%CMAKE_EXE%" (
  echo [ERROR] CMake from Visual Studio Build Tools was not found.
  exit /b 1
)
echo Building native ASIO bridge...
call "%VCVARS64%" >nul
"%CMAKE_EXE%" -S "%ASIO_DIR%" -B "%ASIO_DIR%\build" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_MAKE_PROGRAM="%NINJA_EXE%"
if errorlevel 1 exit /b 1
"%CMAKE_EXE%" --build "%ASIO_DIR%\build"
if errorlevel 1 exit /b 1
copy /Y "%ASIO_DIR%\build\KaraokeAsioBridge.exe" "%BACKEND_DIR%\dist\KaraokeBackend\KaraokeAsioBridge.exe" >nul
if errorlevel 1 exit /b 1

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
echo Done. Installer: %PROJECT_ROOT%release\Karaoke Studio Setup 1.0.0.exe
