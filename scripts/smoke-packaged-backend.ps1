param(
    [string] $Executable = "build\electron\win-unpacked\resources\backend\KaraokeBackend.exe",
    [int] $Port = 18765,
    [int] $TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$resolvedExecutable = (Resolve-Path -LiteralPath $Executable).Path
$smokeData = Join-Path $env:TEMP ("karaoke-smoke-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $smokeData | Out-Null

$env:SONGAPP_PORT = $Port.ToString()
$env:SONGAPP_DATA_DIR = $smokeData
$env:SONGAPP_LOG_DIR = Join-Path $smokeData "logs"

$stdoutPath = Join-Path $smokeData "stdout.log"
$stderrPath = Join-Path $smokeData "stderr.log"
$fcpeOut = Join-Path $smokeData "fcpe-stdout.log"
$fcpeErr = Join-Path $smokeData "fcpe-stderr.log"
$fcpe = Start-Process -FilePath $resolvedExecutable -ArgumentList "--verify-ai-runtime" `
    -WindowStyle Hidden -Wait -PassThru `
    -RedirectStandardOutput $fcpeOut -RedirectStandardError $fcpeErr
if ($fcpe.ExitCode -ne 0) {
    $details = (Get-Content -LiteralPath $fcpeErr -Raw -ErrorAction SilentlyContinue)
    throw "Packaged TorchFCPE runtime check failed (exit code $($fcpe.ExitCode)): $details"
}
Write-Host (Get-Content -LiteralPath $fcpeOut -Raw)

$process = Start-Process -FilePath $resolvedExecutable -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath

try {
    $health = $null
    $attempts = [Math]::Max(1, $TimeoutSeconds * 2)
    for ($attempt = 0; $attempt -lt $attempts; $attempt += 1) {
        Start-Sleep -Milliseconds 500
        if ($process.HasExited) {
            break
        }
        try {
            $health = Invoke-RestMethod "http://127.0.0.1:$Port/diagnostics/health" -TimeoutSec 2
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
    $pipeline = Invoke-RestMethod "http://127.0.0.1:$Port/diagnostics/pipeline" -TimeoutSec 10
    if (-not $pipeline.ffmpeg_available) {
        throw "Packaged backend cannot resolve its bundled FFmpeg executable."
    }
    $versions = Invoke-RestMethod "http://127.0.0.1:$Port/diagnostics/versions" -TimeoutSec 10
    if (-not $versions.components.ffmpeg) {
        throw "Packaged FFmpeg did not execute successfully."
    }
    Write-Host "Health: $($health | ConvertTo-Json -Compress)"
    Write-Host "FFmpeg: $($versions.components.ffmpeg)"
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
