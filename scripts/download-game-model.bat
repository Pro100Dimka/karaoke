@echo off
setlocal EnableExtensions

set "ROOT=%~dp0..\"
set "MODEL_DIR=%ROOT%backend\engines\game\models"
set "MODEL_NAME=GAME-1.0.3-large-onnx"
set "MODEL_PATH=%MODEL_DIR%\%MODEL_NAME%"
set "ARCHIVE=%MODEL_DIR%\%MODEL_NAME%.zip"
set "EXPECTED_SHA256=8a5480539fe7d995800dc0efe149b83a1cd4f4e4a36aa2a1f7665f1765dcac08"
set "MODEL_URL=https://github.com/openvpi/GAME/releases/download/v1.0.3/GAME-1.0.3-large-onnx.zip"

if exist "%MODEL_PATH%\config.json" exit /b 0

echo Downloading the GAME melody model...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; New-Item -ItemType Directory -Force -Path '%MODEL_DIR%' | Out-Null; Invoke-WebRequest -Uri '%MODEL_URL%' -OutFile '%ARCHIVE%'; if ((Get-FileHash -Algorithm SHA256 '%ARCHIVE%').Hash.ToLowerInvariant() -ne '%EXPECTED_SHA256%') { throw 'GAME model checksum mismatch.' }; Expand-Archive -LiteralPath '%ARCHIVE%' -DestinationPath '%MODEL_DIR%' -Force; Remove-Item -LiteralPath '%ARCHIVE%' -Force"
if errorlevel 1 (
  echo [ERROR] GAME model could not be downloaded or verified.
  exit /b 1
)
