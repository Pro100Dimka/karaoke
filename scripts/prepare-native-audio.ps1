param(
    [Parameter(Mandatory = $true)]
    [string]$Root
)

$ErrorActionPreference = "Stop"
$rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\')
$source = Join-Path $rootPath "backend\engines\asio"
$build = Join-Path $rootPath "generated\build\asio"
$sdk = Join-Path $rootPath "downloads\engines\asio-sdk"

$vswhereCandidates = @(
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"),
    (Join-Path $env:ProgramFiles "Microsoft Visual Studio\Installer\vswhere.exe")
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
$vswhere = $vswhereCandidates | Select-Object -First 1
if (-not $vswhere) { throw "Visual Studio locator is missing; run start-dev.bat to install native build tools" }

$visualStudio = & $vswhere -latest -products * `
    -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
    -requires Microsoft.VisualStudio.Component.VC.CMake.Project `
    -property installationPath 2>$null | Select-Object -First 1
if ($LASTEXITCODE -ne 0 -or -not $visualStudio) {
    throw "Visual Studio C++ and CMake build tools are unavailable"
}
$visualStudio = $visualStudio.Trim()
$vcvars = Join-Path $visualStudio "VC\Auxiliary\Build\vcvars64.bat"
$cmake = Join-Path $visualStudio "Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
$ninja = Join-Path $visualStudio "Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe"
foreach ($required in @($vcvars, $cmake, $ninja)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Native audio build tool is missing: $required"
    }
}

New-Item -ItemType Directory -Force -Path $build | Out-Null
$command = 'call "{0}" >nul && "{1}" -S "{2}" -B "{3}" -G Ninja -DCMAKE_BUILD_TYPE=Release -DASIO_SDK_DIR="{4}" -DCMAKE_MAKE_PROGRAM="{5}" && "{1}" --build "{3}" --parallel' -f `
    $vcvars, $cmake, $source, $build, $sdk, $ninja
& $env:ComSpec /D /S /C $command
if ($LASTEXITCODE -ne 0) { throw "Native ASIO/WASAPI compilation failed" }

foreach ($output in @("KaraokeAsioBridge.exe", "KaraokeWasapi.dll")) {
    $path = Join-Path $build $output
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Native audio output is missing: $path"
    }
}
Write-Host "Native ASIO and WASAPI components are ready."
