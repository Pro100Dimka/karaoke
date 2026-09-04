param(
    [Parameter(Mandatory = $true)]
    [string]$Root,
    [Parameter(Mandatory = $true)]
    [string]$OutputEnvironmentFile
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\')
$versionFile = Join-Path $rootPath "front\.nvmrc"
if (-not (Test-Path -LiteralPath $versionFile -PathType Leaf)) {
    throw "Missing Node version file: $versionFile"
}
$RequiredVersion = (Get-Content -LiteralPath $versionFile -Raw).Trim().TrimStart('v')
if ($RequiredVersion -notmatch '^\d+\.\d+\.\d+$') {
    throw "Invalid Node version in .nvmrc: $RequiredVersion"
}

function Get-ValidNodeDirectory([string]$Executable) {
    if (-not $Executable -or -not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return $null }
    $versionOutput = & $Executable --version 2>$null
    $nodeExitCode = $LASTEXITCODE
    $actual = ([string]($versionOutput | Select-Object -First 1)).Trim().TrimStart('v')
    if ($nodeExitCode -ne 0 -or $actual -ne $RequiredVersion) { return $null }
    $directory = Split-Path -Parent ([IO.Path]::GetFullPath($Executable))
    if (-not (Test-Path -LiteralPath (Join-Path $directory "npm.cmd") -PathType Leaf)) { return $null }
    return $directory
}

function Find-CurrentNodeDirectory {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $command) { return $null }
    return Get-ValidNodeDirectory $command.Source
}

function Write-NodeEnvironment([string]$Directory) {
    $parent = Split-Path -Parent $OutputEnvironmentFile
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    Set-Content -LiteralPath $OutputEnvironmentFile -Value $Directory -Encoding Ascii -NoNewline
    Write-Host "Node.js v${RequiredVersion}: $Directory"
}

$nodeDirectory = Find-CurrentNodeDirectory
if ($nodeDirectory) {
    Write-NodeEnvironment $nodeDirectory
    exit 0
}

# Prefer an existing NVM for Windows installation. This keeps a developer's
# Node versions under the version manager they already chose instead of
# creating a second unmanaged installation.
$nvm = Get-Command nvm.exe -ErrorAction SilentlyContinue
if ($nvm) {
    Write-Host "Required Node.js is absent; running nvm install $RequiredVersion..."
    & $nvm.Source "install" $RequiredVersion
    if ($LASTEXITCODE -ne 0) { throw "nvm install failed for Node.js $RequiredVersion" }
    Write-Host "Activating it with nvm use $RequiredVersion..."
    & $nvm.Source "use" $RequiredVersion
    if ($LASTEXITCODE -ne 0) { throw "nvm use failed for Node.js $RequiredVersion" }
    $nodeDirectory = Find-CurrentNodeDirectory
    if (-not $nodeDirectory) {
        $nvmSymlink = [Environment]::GetEnvironmentVariable("NVM_SYMLINK")
        if ($nvmSymlink) { $nodeDirectory = Get-ValidNodeDirectory (Join-Path $nvmSymlink "node.exe") }
    }
    if (-not $nodeDirectory) {
        $nvmExecutableRoot = Split-Path -Parent $nvm.Source
        $nodeDirectory = Get-ValidNodeDirectory (Join-Path $nvmExecutableRoot "v$RequiredVersion\node.exe")
    }
    if (-not $nodeDirectory) {
        Write-Host "Resolving the active installation with nvm root..."
        $rootOutput = (& $nvm.Source "root" 2>$null | Out-String).Trim()
        $nvmRoot = ($rootOutput -replace '^.*?:\s*', '').Trim()
        if ($nvmRoot) {
            $nodeDirectory = Get-ValidNodeDirectory (Join-Path $nvmRoot "v$RequiredVersion\node.exe")
        }
    }
    if (-not $nodeDirectory) { throw "NVM activated Node.js, but v$RequiredVersion is not available on PATH" }
    Write-NodeEnvironment $nodeDirectory
    exit 0
}

# A plain missing/wrong Node installation must not require administrator
# rights. Download the official ZIP into the repository-local runtime cache,
# validate it against Node's published SHASUMS256.txt and prepend it only for
# this start-dev process tree.
$architecture = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
$archiveName = "node-v$RequiredVersion-win-$architecture.zip"
$runtimeParent = Join-Path $rootPath "downloads\runtimes"
$runtimeDirectory = Join-Path $runtimeParent "node-v$RequiredVersion-win-$architecture"
$nodeDirectory = Get-ValidNodeDirectory (Join-Path $runtimeDirectory "node.exe")
if (-not $nodeDirectory) {
    New-Item -ItemType Directory -Force -Path $runtimeParent | Out-Null
    $temporary = Join-Path ([IO.Path]::GetTempPath()) ("advoice-node-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $temporary | Out-Null
    try {
        $baseUrl = "https://nodejs.org/dist/v$RequiredVersion"
        $archivePath = Join-Path $temporary $archiveName
        $checksumsPath = Join-Path $temporary "SHASUMS256.txt"
        Write-Host "Downloading official Node.js v$RequiredVersion..."
        Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/$archiveName" -OutFile $archivePath
        Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/SHASUMS256.txt" -OutFile $checksumsPath
        $checksumLine = Get-Content -LiteralPath $checksumsPath | Where-Object { $_ -match "\s$([regex]::Escape($archiveName))$" } | Select-Object -First 1
        if (-not $checksumLine) { throw "Node checksum entry is missing for $archiveName" }
        $expectedHash = ($checksumLine -split '\s+')[0].ToUpperInvariant()
        $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToUpperInvariant()
        if ($actualHash -ne $expectedHash) { throw "Node.js archive checksum mismatch" }
        Expand-Archive -LiteralPath $archivePath -DestinationPath $temporary -Force
        $extracted = Join-Path $temporary "node-v$RequiredVersion-win-$architecture"
        if (-not (Get-ValidNodeDirectory (Join-Path $extracted "node.exe"))) {
            throw "Downloaded Node.js runtime is incomplete"
        }
        if (Test-Path -LiteralPath $runtimeDirectory) { Remove-Item -LiteralPath $runtimeDirectory -Recurse -Force }
        Move-Item -LiteralPath $extracted -Destination $runtimeDirectory
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
    }
    $nodeDirectory = Get-ValidNodeDirectory (Join-Path $runtimeDirectory "node.exe")
}
if (-not $nodeDirectory) { throw "Could not prepare Node.js v$RequiredVersion" }
Write-NodeEnvironment $nodeDirectory
