param(
    [string] $Executable = "release\win-unpacked\resources\backend\KaraokeBackend.exe",
    [int] $Port = 18765
)

$ErrorActionPreference = "Stop"
$resolvedExecutable = (Resolve-Path -LiteralPath $Executable).Path
$smokeData = Join-Path $env:TEMP ("karaoke-smoke-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $smokeData | Out-Null

$env:SONGAPP_PORT = $Port.ToString()
$env:SONGAPP_DATA_DIR = $smokeData
$env:SONGAPP_LOG_DIR = Join-Path $smokeData "logs"

$process = Start-Process -FilePath $resolvedExecutable -WindowStyle Hidden -PassThru

try {
    $health = $null
    for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
        Start-Sleep -Milliseconds 500
        if ($process.HasExited) {
            break
        }
        try {
            $health = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2
            break
        }
        catch {
            # The frozen backend can take a few seconds to import its libraries.
        }
    }

    if ($null -eq $health) {
        $state = if ($process.HasExited) { "exit code $($process.ExitCode)" } else { "still running" }
        throw "Packaged backend health check failed ($state). Logs: $smokeData"
    }

    $root = Invoke-RestMethod "http://127.0.0.1:$Port/" -TimeoutSec 3
    Write-Host "Health: $($health | ConvertTo-Json -Compress)"
    Write-Host "Root: $($root | ConvertTo-Json -Compress)"
    Write-Host "Packaged backend smoke test passed."
}
finally {
    if (-not $process.HasExited) {
        Stop-Process -Id $process.Id -Force
    }
    Remove-Item Env:SONGAPP_PORT -ErrorAction SilentlyContinue
    Remove-Item Env:SONGAPP_DATA_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:SONGAPP_LOG_DIR -ErrorAction SilentlyContinue
}
