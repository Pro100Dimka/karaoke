param(
    [Parameter(Mandatory = $true)]
    [string]$Root,
    [Parameter(Mandatory = $true)]
    [string]$OutputEnvironmentFile
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\')

function Find-CompatibleVisualStudio {
    $candidates = @(
        (Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"),
        (Join-Path $env:ProgramFiles "Microsoft Visual Studio\Installer\vswhere.exe")
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
    foreach ($vswhere in $candidates) {
        # vswhere prints nothing (not an error) when no installation satisfies
        # -requires -- e.g. Visual Studio is present but without the C++/CMake
        # workload. Select-Object then yields $null, and calling .Trim() on
        # that crashed with "Cannot call a method on a null-valued expression"
        # instead of falling through to the Build Tools installer below.
        $installation = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 Microsoft.VisualStudio.Component.VC.CMake.Project -property installationPath 2>$null | Select-Object -First 1
        if ($LASTEXITCODE -eq 0 -and $installation) { return $installation.Trim() }
    }
    return $null
}

if (-not (Find-CompatibleVisualStudio)) {
    Write-Host "Visual Studio C++/CMake tools are missing. Installing the required workload..."
    Write-Host "Windows may ask once for administrator approval. The first setup can take a while."
    $installer = Join-Path ([IO.Path]::GetTempPath()) "advoice-vs_BuildTools.exe"
    Invoke-WebRequest -UseBasicParsing -Uri "https://aka.ms/vs/17/release/vs_BuildTools.exe" -OutFile $installer
    $arguments = @(
        "--quiet", "--wait", "--norestart", "--nocache",
        "--add", "Microsoft.VisualStudio.Workload.VCTools",
        "--add", "Microsoft.VisualStudio.Component.VC.CMake.Project",
        "--includeRecommended"
    )
    $process = Start-Process -FilePath $installer -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -notin @(0, 3010)) {
        throw "Visual Studio Build Tools installation failed with exit code $($process.ExitCode)"
    }
    if (-not (Find-CompatibleVisualStudio)) {
        throw "Visual Studio Build Tools finished, but C++ and CMake components are unavailable"
    }
}

function Find-FfmpegDirectory {
    $command = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
    if ($command) { return Split-Path -Parent $command.Source }
    $cached = Join-Path $rootPath "downloads\runtimes\ffmpeg\bin\ffmpeg.exe"
    if (Test-Path -LiteralPath $cached -PathType Leaf) { return Split-Path -Parent $cached }
    return $null
}

$ffmpegDirectory = Find-FfmpegDirectory
if (-not $ffmpegDirectory) {
    $runtimeParent = Join-Path $rootPath "downloads\runtimes"
    $runtimeDirectory = Join-Path $runtimeParent "ffmpeg"
    $temporary = Join-Path ([IO.Path]::GetTempPath()) ("advoice-ffmpeg-" + [guid]::NewGuid().ToString("N"))
    $archiveName = "ffmpeg-master-latest-win64-gpl.zip"
    $releaseUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"
    New-Item -ItemType Directory -Force -Path $runtimeParent | Out-Null
    New-Item -ItemType Directory -Path $temporary | Out-Null
    try {
        $archivePath = Join-Path $temporary $archiveName
        $checksumsPath = Join-Path $temporary "checksums.sha256"
        Write-Host "Downloading FFmpeg..."
        Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/$archiveName" -OutFile $archivePath
        Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/checksums.sha256" -OutFile $checksumsPath
        $checksumLine = Get-Content -LiteralPath $checksumsPath | Where-Object { $_ -match "\s\*?$([regex]::Escape($archiveName))$" } | Select-Object -First 1
        if (-not $checksumLine) { throw "FFmpeg checksum entry is missing" }
        $expectedHash = ($checksumLine -split '\s+')[0].ToUpperInvariant()
        $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToUpperInvariant()
        if ($actualHash -ne $expectedHash) { throw "FFmpeg archive checksum mismatch" }
        $expanded = Join-Path $temporary "expanded"
        Expand-Archive -LiteralPath $archivePath -DestinationPath $expanded -Force
        $ffmpeg = Get-ChildItem -LiteralPath $expanded -Filter ffmpeg.exe -File -Recurse | Select-Object -First 1
        $ffprobe = Get-ChildItem -LiteralPath $expanded -Filter ffprobe.exe -File -Recurse | Select-Object -First 1
        if (-not $ffmpeg -or -not $ffprobe) { throw "Downloaded FFmpeg runtime is incomplete" }
        $bin = Join-Path $runtimeDirectory "bin"
        if (Test-Path -LiteralPath $runtimeDirectory) { Remove-Item -LiteralPath $runtimeDirectory -Recurse -Force }
        New-Item -ItemType Directory -Force -Path $bin | Out-Null
        Copy-Item -LiteralPath $ffmpeg.FullName -Destination (Join-Path $bin "ffmpeg.exe")
        Copy-Item -LiteralPath $ffprobe.FullName -Destination (Join-Path $bin "ffprobe.exe")
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
    }
    $ffmpegDirectory = Find-FfmpegDirectory
}
if (-not $ffmpegDirectory) { throw "Could not prepare FFmpeg" }
$parent = Split-Path -Parent $OutputEnvironmentFile
if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
Set-Content -LiteralPath $OutputEnvironmentFile -Value $ffmpegDirectory -Encoding Ascii -NoNewline
Write-Host "FFmpeg: $ffmpegDirectory"
Write-Host "Visual Studio native build tools: ready"
