param(
    [Parameter(Mandatory = $true)]
    [string] $BackendDir,

    [Parameter(Mandatory = $true)]
    [string] $FrontendDir,

    [Parameter(Mandatory = $true)]
    [string] $InstallerDirectory,

    [Parameter(Mandatory = $true)]
    [string] $SbomFile,

    [Parameter(Mandatory = $true)]
    [string] $OutputFile,

    [string] $BuildId = ""
)

# Records exactly what went into a release build -- versions, pinned
# dependencies, model checksums, and hashes of the shipped installer files --
# so two builds can be compared without re-running either one. Deliberately
# does not require Git: sourceRevisionOrBuildId falls back to an explicit
# build-system id (env var) so this also works from a source archive that
# was never a Git checkout.
$ErrorActionPreference = "Stop"

function Get-BuildId([string]$Explicit) {
    if ($Explicit) { return $Explicit }
    foreach ($envName in @("SONGAPP_BUILD_ID", "BUILD_ID", "GITHUB_SHA", "CI_COMMIT_SHA")) {
        $value = [Environment]::GetEnvironmentVariable($envName)
        if ($value) { return $value }
    }
    try {
        $sha = (& git rev-parse HEAD 2>$null)
        if ($LASTEXITCODE -eq 0 -and $sha) { return $sha.Trim() }
    }
    catch {}
    return "unknown"
}

function Get-CommandVersion([string]$Command, [string[]]$Arguments) {
    try {
        $output = & $Command @Arguments 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $output) { return $null }
        return ($output | Select-Object -First 1).ToString().Trim()
    }
    catch {
        return $null
    }
}

$packageJsonPath = Join-Path $FrontendDir "package.json"
if (-not (Test-Path -LiteralPath $packageJsonPath)) {
    throw "front package.json not found: $packageJsonPath"
}
$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json

$dependencies = [ordered]@{}
if ($packageJson.dependencies) {
    foreach ($name in $packageJson.dependencies.PSObject.Properties.Name) {
        $dependencies["front:$name"] = $packageJson.dependencies.$name
    }
}
$lockFile = Join-Path $BackendDir "requirements-lock.txt"
if (Test-Path -LiteralPath $lockFile) {
    foreach ($line in Get-Content -LiteralPath $lockFile) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
        if ($trimmed -match '^([A-Za-z0-9_.-]+)==([^\s\\]+)') {
            $dependencies["backend:$($Matches[1])"] = $Matches[2]
        }
    }
}

$pythonExe = Join-Path $BackendDir "venv\Scripts\python.exe"
$pythonVersion = $null
$models = @()
if (Test-Path -LiteralPath $pythonExe) {
    $rawPythonVersion = Get-CommandVersion $pythonExe @("--version")
    if ($rawPythonVersion) { $pythonVersion = ($rawPythonVersion -replace "^Python\s+", "") }

    # Single-quoted Python string literals here: PowerShell's argument
    # marshalling to a native exe mangles embedded double quotes, which
    # broke json.dumps({"id": ...}) silently (Python saw bare, unquoted
    # identifiers). json.dumps() always emits proper double-quoted JSON
    # regardless of which quote style the source used.
    $modelsScript = @'
import json, sys
sys.path.insert(0, sys.argv[1])
from AI.model_registry import MODELS
print(json.dumps([{'id': m.key, 'revision': m.revision, 'sha256': m.sha256} for m in MODELS]))
'@
    try {
        $modelsJson = & $pythonExe -c $modelsScript $BackendDir 2>$null
        if ($LASTEXITCODE -eq 0 -and $modelsJson) { $models = @(($modelsJson | ConvertFrom-Json)) }
    }
    catch {}
}

$files = @()
if (Test-Path -LiteralPath $InstallerDirectory) {
    $files = @(
        Get-ChildItem -LiteralPath $InstallerDirectory -File |
        Where-Object { $_.Extension -in ".exe", ".bin" } |
        Sort-Object Name |
        ForEach-Object {
            [ordered]@{
                path   = $_.Name
                sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            }
        }
    )
}

$ffmpegVersion = $null
if (Test-Path -LiteralPath $pythonExe) {
    Push-Location $BackendDir
    try {
        $ffmpegExe = Get-CommandVersion $pythonExe @("-c", "import config; print(config.FFMPEG_EXE)")
    }
    finally {
        Pop-Location
    }
    if ($ffmpegExe -and (Test-Path -LiteralPath $ffmpegExe -ErrorAction SilentlyContinue)) {
        $ffmpegVersion = Get-CommandVersion $ffmpegExe @("-version")
    }
}

if (-not (Test-Path -LiteralPath $SbomFile -PathType Leaf)) {
    throw "Mandatory release SBOM does not exist: $SbomFile"
}
$sha = [Security.Cryptography.SHA256]::Create()
$stream = [IO.File]::OpenRead($SbomFile)
try {
    $sbom = [ordered]@{
        path = (Split-Path $SbomFile -Leaf)
        sha256 = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace("-","").ToLowerInvariant()
    }
}
finally {
    $stream.Dispose()
    $sha.Dispose()
}

$manifest = [ordered]@{
    appVersion             = $packageJson.version
    sourceRevisionOrBuildId = (Get-BuildId $BuildId)
    node                   = (Get-CommandVersion "node" @("--version"))
    npm                    = (Get-CommandVersion "npm" @("--version"))
    python                 = $pythonVersion
    dependencies           = $dependencies
    models                 = $models
    ffmpeg                 = $ffmpegVersion
    sbom                   = $sbom
    files                  = $files
}

$json = $manifest | ConvertTo-Json -Depth 6
$utf8WithoutBom = [Text.UTF8Encoding]::new($false)
$outputDirectory = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($OutputFile))
if (-not [string]::IsNullOrWhiteSpace($outputDirectory)) {
    [IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
}
[IO.File]::WriteAllText($OutputFile, $json, $utf8WithoutBom)
Write-Host "Created $OutputFile"
