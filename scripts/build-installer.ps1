param(
    [ValidateSet("full","fast","installer","clean")]
    [string]$Mode = "full",

    [ValidateSet("","backend","asio","frontend","package-models")]
    [string]$Worker = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2

$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "front"
$Build = Join-Path $Root "build"
$Downloads = Join-Path $Root "downloads"
$Release = Join-Path $Root "release"

$BackendDist = Join-Path $Build "backend\dist\KaraokeBackend"
$Unpacked = Join-Path $Build "electron\win-unpacked"
$InstallerDir = Join-Path $Build "installer-output"
$TempDir = Join-Path $Build "installer-temp"
$StateDir = Join-Path $Build ".state"
$ExternalPayload = Join-Path $Build "external-ai"
$ExternalModels = Join-Path $ExternalPayload "models"
$ExternalMsst = Join-Path $ExternalPayload "msst"

$PreservedAI = Join-Path $Build "preserved-ai"
$PreservedModels = Join-Path $PreservedAI "models"
$PreservedMSST = Join-Path $PreservedAI "msst"
$ParallelDir = Join-Path $Build "parallel"

$Python = Join-Path $Backend "venv\Scripts\python.exe"
$PackagedBackend = Join-Path $Unpacked "resources\backend"

$SceneVideoSource = Join-Path $Downloads "media\videoplayback.webm"
$PackagedSceneVideo = Join-Path $Unpacked "resources\media\videoplayback.webm"

$Asio = Join-Path $Backend "engines\asio"
$AsioBuild = Join-Path $Build "asio"
$AsioSdk = Join-Path $Downloads "engines\asio-sdk"

$Models = Join-Path $Downloads "models"
$MsstEngine = Join-Path $Downloads "engines\msst"

$Vs = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools"
$VcVars = Join-Path $Vs "VC\Auxiliary\Build\vcvars64.bat"
$CMake = Join-Path $Vs "Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
$Ninja = Join-Path $Vs "Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe"

$AppName = "A&D Voice"
$AppVersion = "1.0.0"
$AppExe = "A&D Voice.exe"
$AppId = "E734496E-2622-5565-89D3-45451D9DE7EE"

$ModelCheck = Join-Path $Backend "AI\install_models.py"
$InnoTemplate = Join-Path $Root "scripts\karaoke-studio.iss"
$SignScript = Join-Path $Root "scripts\sign-windows.ps1"
$SetupIcon = Join-Path $Frontend "assets\icons\app.ico"

$InstallerExe = Join-Path $InstallerDir "A&D Voice Setup $AppVersion.exe"
$ChecksumFile = Join-Path $InstallerDir "SHA256SUMS.txt"
$IsoName = "A&D Voice $AppVersion.iso"
$IsoFile = Join-Path $Release $IsoName
$IsoStage = Join-Path $Build "iso-root"
$IsoTemp = Join-Path $Build $IsoName

$SmokeScript = Join-Path $Root "scripts\smoke-packaged-backend.ps1"
$ChecksumScript = Join-Path $Root "scripts\generate-checksums.ps1"
$script:BackendChanged = $false
$script:AsioChanged = $false
$script:FrontendChanged = $false
$script:ModelsChanged = $false
$script:BackendFingerprint = ""
$script:AsioFingerprint = ""
$script:FrontendFingerprint = ""
$script:ModelsFingerprint = ""

function Write-Header([string]$Text) {
    Write-Host ""
    Write-Host ("=" * 60)
    Write-Host " $Text"
    Write-Host ("=" * 60)
    Write-Host ""
}

function Require-File([string]$Path, [string]$Name) {
    Write-Host "Checking ${Name}:"
    Write-Host "  $Path"

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Name was not found: $Path"
    }

    Write-Host "[OK] $Name"
    Write-Host ""
}

function Require-Directory([string]$Path, [string]$Name) {
    Write-Host "Checking ${Name}:"
    Write-Host "  $Path"

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "$Name was not found: $Path"
    }

    Write-Host "[OK] $Name"
    Write-Host ""
}

function Test-ExcludedPath(
    [string]$FullName,
    [string[]]$ExcludeDirectoryNames = @(),
    [string[]]$ExcludeFilePatterns = @(),
    [string[]]$ExcludeRegexes = @()
) {
    $normalized = $FullName.Replace('/','\')

    foreach ($dir in $ExcludeDirectoryNames) {
        if ($normalized -match ('(?i)(^|\\)' + [Regex]::Escape($dir) + '(\\|$)')) {
            return $true
        }
    }

    $name = [IO.Path]::GetFileName($normalized)

    foreach ($pattern in $ExcludeFilePatterns) {
        if ($name -like $pattern) {
            return $true
        }
    }

    foreach ($regex in $ExcludeRegexes) {
        if ($normalized -match $regex) {
            return $true
        }
    }

    return $false
}

function Get-Fingerprint(
    [string[]]$Paths,
    [string[]]$ExcludeDirectoryNames = @(),
    [string[]]$ExcludeFilePatterns = @(),
    [string[]]$ExcludeRegexes = @()
) {
    $rows = New-Object System.Collections.Generic.List[string]

    foreach ($path in $Paths) {
        if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path -LiteralPath $path)) {
            $rows.Add("MISSING|$path")
            continue
        }

        $item = Get-Item -LiteralPath $path -Force

        if (-not $item.PSIsContainer) {
            if (-not (Test-ExcludedPath $item.FullName $ExcludeDirectoryNames $ExcludeFilePatterns $ExcludeRegexes)) {
                $rows.Add("F|$($item.FullName.ToLowerInvariant())|$($item.Length)|$($item.LastWriteTimeUtc.Ticks)")
            }
            continue
        }

        $root = [IO.Path]::GetFullPath($item.FullName).TrimEnd('\')

        Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue |
            ForEach-Object {
                if (-not (Test-ExcludedPath $_.FullName $ExcludeDirectoryNames $ExcludeFilePatterns $ExcludeRegexes)) {
                    $relative = $_.FullName.Substring($root.Length).TrimStart('\').ToLowerInvariant()
                    $rows.Add("F|$root|$relative|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)")
                }
            }
    }

    $payload = [Text.Encoding]::UTF8.GetBytes((($rows | Sort-Object) -join "`n"))
    $sha = [Security.Cryptography.SHA256]::Create()

    try {
        return ([BitConverter]::ToString($sha.ComputeHash($payload))).Replace("-","").ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
}

function Get-CombinedFingerprint([string[]]$Values) {
    $payload = [Text.Encoding]::UTF8.GetBytes(($Values -join "|"))
    $sha = [Security.Cryptography.SHA256]::Create()

    try {
        return ([BitConverter]::ToString($sha.ComputeHash($payload))).Replace("-","").ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
}

function Get-StatePath([string]$Name) {
    return Join-Path $StateDir "$Name.sha256"
}

function Get-State([string]$Name) {
    $path = Get-StatePath $Name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return "" }
    return (Get-Content -LiteralPath $path -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
}

function Set-State([string]$Name, [string]$Fingerprint) {
    New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
    $Fingerprint | Set-Content -LiteralPath (Get-StatePath $Name) -Encoding ASCII
}

function Test-StepNeeded(
    [string]$Name,
    [string]$Fingerprint,
    [string[]]$RequiredOutputs = @(),
    [switch]$Force
) {
    if ($Force) {
        Write-Host "  $Name`: forced"
        return $true
    }

    foreach ($output in $RequiredOutputs) {
        if (-not (Test-Path -LiteralPath $output)) {
            Write-Host "  $Name`: output missing"
            return $true
        }
    }

    if ((Get-State $Name) -ne $Fingerprint) {
        Write-Host "  $Name`: changed"
        return $true
    }

    Write-Host "  $Name`: unchanged [skip]"
    return $false
}

function Get-BackendFingerprint {
    return Get-Fingerprint @($Backend) `
        @("venv","data","Song","full_songs","recordings","__pycache__",".pytest_cache",".cache","dist","build") `
        @("*.pyc","*.pyo","*.log","*.db","*.sqlite","*.sqlite3")
}

function Get-FrontendFingerprint {
    return Get-Fingerprint @($Frontend) `
        @("node_modules","dist","build",".git",".cache",".vite","coverage","playwright-report","test-results") `
        @("*.log")
}

function Get-AsioFingerprint {
    return Get-Fingerprint @($Asio,$AsioSdk) `
        @("build",".git",".cache","__pycache__") `
        @("*.obj","*.pdb","*.ilk","*.log")
}

function Get-ModelsFingerprint {
    return Get-Fingerprint @($Models,$MsstEngine) `
        @(".cache",".git","__pycache__") `
        @("*.metadata","*.lock","*.tmp","*.part")
}

function Get-ElectronFingerprint {
    return Get-Fingerprint @(
        (Join-Path $Build "frontend\dist"),
        $BackendDist,
        (Join-Path $Frontend "package.json"),
        (Join-Path $Frontend "package-lock.json"),
        (Join-Path $Frontend "electron"),
        $SceneVideoSource
    ) `
        @(".cache",".git","__pycache__") `
        @("*.metadata","*.lock") `
        @(
            '(?i)\\_internal\\models(\\|$)',
            '(?i)\\_internal\\engines\\msst(\\|$)'
        )
}

function Get-InstallerFingerprint {
    return Get-Fingerprint @($Unpacked,$InnoTemplate,$SetupIcon) `
        @(".cache",".git","__pycache__") `
        @("*.metadata","*.lock") `
        @(
            '(?i)\\resources\\backend\\_internal\\models(\\|$)',
            '(?i)\\resources\\backend\\_internal\\engines\\msst(\\|$)'
        )
}

function Remove-IgnoredPayloadFiles([string]$RootPath) {
    if (-not (Test-Path -LiteralPath $RootPath -PathType Container)) { return }

    Get-ChildItem -LiteralPath $RootPath -Recurse -Directory -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -in @(".cache",".git","__pycache__") } |
        Sort-Object { $_.FullName.Length } -Descending |
        ForEach-Object {
            Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
        }

    Get-ChildItem -LiteralPath $RootPath -Recurse -File -Force -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -like "*.metadata" -or
            $_.Name -like "*.lock" -or
            $_.Name -like "*.tmp" -or
            $_.Name -like "*.part"
        } |
        Remove-Item -Force -ErrorAction SilentlyContinue
}

function Remove-Directory([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw "Refusing to remove an empty path."
    }

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    Write-Host "Removing:"
    Write-Host "  $Path"

    for ($i = 1; $i -le 10; $i++) {
        try {
            Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
        }
        catch {
        }

        if (-not (Test-Path -LiteralPath $Path)) {
            return
        }

        Write-Host "  Directory is still locked. Retry $i/10..."

        if ([IO.Path]::GetFullPath($Path).TrimEnd('\') -eq [IO.Path]::GetFullPath($Release).TrimEnd('\')) {
            Stop-BuildProcesses -Quiet
        }

        Start-Sleep -Seconds 2
    }

    throw "Could not remove directory: $Path"
}

function Stop-BuildProcesses {
    param([switch]$Quiet)

    if (-not $Quiet) {
        Write-Host ""
        Write-Host "[0/6] Closing old A&D Voice build processes..."
    }

    foreach ($name in @("A&D Voice","KaraokeBackend","KaraokeAudioMonitor","KaraokeAsioBridge")) {
        Get-Process -Name $name -ErrorAction SilentlyContinue |
            Stop-Process -Force -ErrorAction SilentlyContinue
    }

    if (Test-Path -LiteralPath $Release) {
        $releaseFull = [IO.Path]::GetFullPath($Release)

        Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
            try {
                if ($_.Path) {
                    $full = [IO.Path]::GetFullPath($_.Path)

                    if ($full.StartsWith($releaseFull, [StringComparison]::OrdinalIgnoreCase)) {
                        if (-not $Quiet) {
                            Write-Host "  Closing PID $($_.Id): $($_.ProcessName)"
                        }

                        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
                    }
                }
            }
            catch {
            }
        }
    }

    if (-not $Quiet) {
        Start-Sleep -Seconds 2
    }
}

function Get-RequiredCommand([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1

    if (-not $cmd) {
        throw "$Name was not found in PATH."
    }

    return $cmd.Source
}

function Find-Oscdimg {
    if ($env:OSCDIMG_OVERRIDE -and (Test-Path -LiteralPath $env:OSCDIMG_OVERRIDE -PathType Leaf)) {
        return [IO.Path]::GetFullPath($env:OSCDIMG_OVERRIDE)
    }

    $cmd = Get-Command oscdimg.exe -ErrorAction SilentlyContinue | Select-Object -First 1

    if ($cmd) {
        return $cmd.Source
    }

    $roots = @(
        (Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\Assessment and Deployment Kit\Deployment Tools"),
        (Join-Path $env:ProgramFiles "Windows Kits\10\Assessment and Deployment Kit\Deployment Tools")
    )

    foreach ($root in $roots) {
        if (-not $root -or -not (Test-Path -LiteralPath $root -PathType Container)) {
            continue
        }

        foreach ($candidate in @(
            (Join-Path $root "amd64\Oscdimg\oscdimg.exe"),
            (Join-Path $root "x86\Oscdimg\oscdimg.exe"),
            (Join-Path $root "arm64\Oscdimg\oscdimg.exe")
        )) {
            if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                return $candidate
            }
        }

        $found = Get-ChildItem -LiteralPath $root -Recurse -File -Filter "oscdimg.exe" -ErrorAction SilentlyContinue |
            Select-Object -First 1

        if ($found) {
            return $found.FullName
        }
    }

    return $null
}

function Initialize-ImapiStreamWriter {
    if ("AdVoice.ImapiStreamWriter" -as [type]) {
        return
    }

    Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

namespace AdVoice
{
    public static class ImapiStreamWriter
    {
        public static void CopyToFile(IStream source, string path)
        {
            byte[] buffer = new byte[1024 * 1024];
            IntPtr readPtr = Marshal.AllocHGlobal(sizeof(int));

            try
            {
                using (FileStream output = new FileStream(
                    path,
                    FileMode.Create,
                    FileAccess.Write,
                    FileShare.None,
                    buffer.Length,
                    FileOptions.SequentialScan))
                {
                    while (true)
                    {
                        Marshal.WriteInt32(readPtr, 0);
                        source.Read(buffer, buffer.Length, readPtr);
                        int read = Marshal.ReadInt32(readPtr);

                        if (read <= 0)
                        {
                            break;
                        }

                        output.Write(buffer, 0, read);
                    }

                    output.Flush();
                }
            }
            finally
            {
                Marshal.FreeHGlobal(readPtr);
            }
        }
    }
}
"@
}

function New-IsoWithWindowsImapi(
    [string]$SourceDirectory,
    [string]$OutputFile,
    [string]$VolumeName
) {
    Require-Directory $SourceDirectory "ISO source directory"

    Write-Host "ISO engine:"
    Write-Host "  Windows IMAPI2FS (built in)"
    Write-Host ""

    Initialize-ImapiStreamWriter

    $fsi = $null
    $result = $null
    $stream = $null

    try {
        $fsi = New-Object -ComObject IMAPI2FS.MsftFileSystemImage

        # 4 = UDF. UDF is required because AI model files may exceed 4 GB.
        $fsi.FileSystemsToCreate = 4
        $fsi.VolumeName = $VolumeName

        try {
            # UDF 1.02 offers broad Windows compatibility.
            $fsi.UDFRevision = 0x0102
        }
        catch {
            # Some Windows builds do not expose this setter. The default UDF
            # revision is still suitable, so this is intentionally non-fatal.
        }

        Write-Host "Adding files to ISO image..."
        $fsi.Root.AddTree($SourceDirectory, $false)

        Write-Host "Generating UDF image stream..."
        $result = $fsi.CreateResultImage()
        $stream = $result.ImageStream

        if (Test-Path -LiteralPath $OutputFile -PathType Leaf) {
            Remove-Item -LiteralPath $OutputFile -Force
        }

        Write-Host "Writing ISO:"
        Write-Host "  $OutputFile"
        Write-Host ""

        [AdVoice.ImapiStreamWriter]::CopyToFile(
            [System.Runtime.InteropServices.ComTypes.IStream]$stream,
            $OutputFile
        )
    }
    catch {
        throw "Windows IMAPI ISO creation failed: $($_.Exception.Message)"
    }
    finally {
        foreach ($comObject in @($stream, $result, $fsi)) {
            if ($null -ne $comObject -and [Runtime.InteropServices.Marshal]::IsComObject($comObject)) {
                try {
                    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($comObject)
                }
                catch {
                }
            }
        }

        [GC]::Collect()
        [GC]::WaitForPendingFinalizers()
    }

    Require-File $OutputFile "Distribution ISO"
}

function New-DistributionIsoImage(
    [string]$SourceDirectory,
    [string]$OutputFile,
    [string]$VolumeName
) {
    if ($script:Oscdimg) {
        Write-Host "ISO engine:"
        Write-Host "  Microsoft Oscdimg"
        Write-Host "  $script:Oscdimg"
        Write-Host ""

        $isoProcess = Start-Process `
            -FilePath $script:Oscdimg `
            -ArgumentList @(
                "-m",
                "-o",
                "-u2",
                "-udfver102",
                "-l$VolumeName",
                $SourceDirectory,
                $OutputFile
            ) `
            -PassThru `
            -Wait `
            -NoNewWindow

        if ($isoProcess.ExitCode -ne 0) {
            throw "Oscdimg failed. Exit code: $($isoProcess.ExitCode)"
        }

        Require-File $OutputFile "Distribution ISO"
        return
    }

    New-IsoWithWindowsImapi `
        -SourceDirectory $SourceDirectory `
        -OutputFile $OutputFile `
        -VolumeName $VolumeName
}

function Check-Environment {
    Write-Host ""
    Write-Host "[0/6] Checking build environment..."
    Write-Host ""

    Require-Directory $Backend "Backend directory"
    Require-Directory $Frontend "Frontend directory"
    Require-File $InnoTemplate "Inno Setup template"

    $script:Oscdimg = Find-Oscdimg

    Write-Host "Checking ISO builder:"
    if ($script:Oscdimg) {
        Write-Host "  Microsoft Oscdimg:"
        Write-Host "  $script:Oscdimg"
        Write-Host "[OK] ISO builder: Oscdimg"
        Write-Host ""
    }
    else {
        Write-Host "  Microsoft Oscdimg: not installed"
        Write-Host "  Fallback: Windows IMAPI2FS"
        Write-Host "[OK] ISO builder: built-in Windows IMAPI fallback"
        Write-Host ""
    }

    if ($Mode -eq "installer") {
        return
    }

    Require-File $Python "Backend virtual environment Python"

    if ($Mode -eq "fast") {
        Verify-BackendBase
        return
    }

    Require-File $VcVars "Visual C++ Build Tools"
    Require-File $CMake "Visual Studio CMake"
    Require-File $Ninja "Visual Studio Ninja"
    Require-Directory $Asio "ASIO source directory"
    Require-Directory $AsioSdk "ASIO SDK directory"
    Require-File $ModelCheck "AI model verification script"

    $script:NodeExe = Get-RequiredCommand "node.exe"
    $script:NpmCmd = Get-RequiredCommand "npm.cmd"
    $script:NpxCmd = Get-RequiredCommand "npx.cmd"
    $script:Ffmpeg = Get-RequiredCommand "ffmpeg.exe"

    Write-Host "Checking node.exe:"
    Write-Host "  $script:NodeExe"
    Write-Host "[OK] node.exe"
    Write-Host ""

    Write-Host "Checking npm.cmd:"
    Write-Host "  $script:NpmCmd"
    Write-Host "[OK] npm.cmd"
    Write-Host ""

    Write-Host "Checking ffmpeg.exe:"
    Write-Host "  $script:Ffmpeg"
    Write-Host "[OK] ffmpeg.exe"
    Write-Host ""

    Write-Host "Python:"
    Write-Host "  $Python"
    Write-Host ""
    Write-Host "FFmpeg:"
    Write-Host "  $script:Ffmpeg"
    Write-Host ""
}

function Preserve-PackagedAI {
    if ($Mode -eq "clean") {
        return
    }

    $currentModels = Join-Path $BackendDist "_internal\models"
    $currentMsst = Join-Path $BackendDist "_internal\engines\msst"

    if (Test-Path -LiteralPath $PreservedAI) {
        Remove-Directory $PreservedAI
    }

    New-Item -ItemType Directory -Path $PreservedAI -Force | Out-Null

    if (Test-Path -LiteralPath $currentModels) {
        Write-Host ""
        Write-Host "Preserving existing packaged AI models..."
        Write-Host "  FROM: $currentModels"
        Write-Host "  TO:   $PreservedModels"
        Move-Item -LiteralPath $currentModels -Destination $PreservedModels -Force
    }

    if (Test-Path -LiteralPath $currentMsst) {
        Write-Host "Preserving existing packaged MSST engine..."
        Move-Item -LiteralPath $currentMsst -Destination $PreservedMSST -Force
    }
}

function Restore-PackagedAI {
    if ($Mode -eq "clean") {
        return
    }

    $internal = Join-Path $BackendDist "_internal"
    $modelsDst = Join-Path $internal "models"
    $enginesDst = Join-Path $internal "engines"
    $msstDst = Join-Path $enginesDst "msst"

    if (Test-Path -LiteralPath $PreservedModels) {
        Write-Host ""
        Write-Host "Restoring preserved AI models..."

        New-Item -ItemType Directory -Path $internal -Force | Out-Null

        if (Test-Path -LiteralPath $modelsDst) {
            Remove-Directory $modelsDst
        }

        Move-Item -LiteralPath $PreservedModels -Destination $modelsDst -Force
        Write-Host "  AI models restored."
    }

    if (Test-Path -LiteralPath $PreservedMSST) {
        Write-Host "Restoring preserved MSST inference engine..."

        New-Item -ItemType Directory -Path $enginesDst -Force | Out-Null

        if (Test-Path -LiteralPath $msstDst) {
            Remove-Directory $msstDst
        }

        Move-Item -LiteralPath $PreservedMSST -Destination $msstDst -Force
        Write-Host "  MSST engine restored."
    }

    if (Test-Path -LiteralPath $PreservedAI) {
        Remove-Item -LiteralPath $PreservedAI -Force -ErrorAction SilentlyContinue
    }
}

function Prepare-Output {
    Write-Host ""
    Write-Host "[0/7] Preparing smart incremental build..."

    if ($Mode -eq "clean") {
        Write-Host ""
        Write-Host "Performing complete clean build..."
        Write-Host ""

        Remove-Directory $Release
        Remove-Directory $Build

        $pyInstallerCache = Join-Path $env:LOCALAPPDATA "pyinstaller"
        Remove-Directory $pyInstallerCache
    }

    New-Item -ItemType Directory -Path $Build -Force | Out-Null
    New-Item -ItemType Directory -Path $Release -Force | Out-Null
    New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
    New-Item -ItemType Directory -Path $InstallerDir -Force | Out-Null
}

function Check-Models {
    Write-Host ""
    Write-Host "[1/6] Checking all registered offline AI models..."

    $old = $env:PYTHONPATH

    try {
        if ($old) {
            $env:PYTHONPATH = "$Backend;$old"
        }
        else {
            $env:PYTHONPATH = $Backend
        }

        & $Python $ModelCheck `
            --downloads $Downloads `
            --msst $MsstEngine `
            --env (Join-Path $Downloads "ai-environment.bat") `
            --check

        if ($LASTEXITCODE -ne 0) {
            throw "Offline model verification failed."
        }
    }
    finally {
        $env:PYTHONPATH = $old
    }
}

function Ensure-PyInstaller {
    $checkOut = Join-Path $env:TEMP "advoice-pyinstaller-check.out"
    $checkErr = Join-Path $env:TEMP "advoice-pyinstaller-check.err"

    Remove-Item -LiteralPath $checkOut,$checkErr -Force -ErrorAction SilentlyContinue

    $check = Start-Process `
        -FilePath $Python `
        -ArgumentList @("-m","PyInstaller","--version") `
        -RedirectStandardOutput $checkOut `
        -RedirectStandardError $checkErr `
        -PassThru `
        -Wait `
        -NoNewWindow

    if ($check.ExitCode -ne 0) {
        Write-Host ""
        Write-Host "PyInstaller is not installed. Installing..."
        Write-Host ""

        $install = Start-Process `
            -FilePath $Python `
            -ArgumentList @("-m","pip","install","pyinstaller") `
            -PassThru `
            -Wait `
            -NoNewWindow

        if ($install.ExitCode -ne 0) {
            throw "PyInstaller installation failed. Exit code: $($install.ExitCode)"
        }

        Remove-Item -LiteralPath $checkOut,$checkErr -Force -ErrorAction SilentlyContinue

        $check = Start-Process `
            -FilePath $Python `
            -ArgumentList @("-m","PyInstaller","--version") `
            -RedirectStandardOutput $checkOut `
            -RedirectStandardError $checkErr `
            -PassThru `
            -Wait `
            -NoNewWindow

        if ($check.ExitCode -ne 0) {
            if (Test-Path -LiteralPath $checkErr) {
                Get-Content -LiteralPath $checkErr
            }
            throw "PyInstaller is still unavailable after installation."
        }
    }

    $version = ""
    if (Test-Path -LiteralPath $checkOut) {
        $version = (Get-Content -LiteralPath $checkOut -ErrorAction SilentlyContinue | Select-Object -First 1)
    }

    if ([string]::IsNullOrWhiteSpace($version)) {
        $version = "installed"
    }

    Write-Host "PyInstaller version: $version"

    Remove-Item -LiteralPath $checkOut,$checkErr -Force -ErrorAction SilentlyContinue
}

function Build-Backend {
    Write-Host ""
    Write-Host "[2/6] Building Python executables..."

    Ensure-PyInstaller

    Remove-Directory (Join-Path $Build "backend\dist")
    New-Item -ItemType Directory -Path (Join-Path $Build "backend\dist") -Force | Out-Null

    Push-Location $Backend

    try {
        Write-Host ""
        Write-Host "Building KaraokeBackend.exe..."
        Write-Host ""

        $args = @(
            "-m","PyInstaller",
            "--log-level","ERROR",
            "--noconfirm"
        )

        if ($Mode -eq "clean") {
            $args += "--clean"
        }

        $args += @(
            "--onedir",
            "--name","KaraokeBackend",
            "--distpath",(Join-Path $Build "backend\dist"),
            "--workpath",(Join-Path $Build "backend\pyinstaller\KaraokeBackend"),
            "--specpath",(Join-Path $Build "backend\spec"),
            "--paths",(Join-Path $Backend "AI"),
            "--paths",$MsstEngine,
            "--add-data","$(Join-Path $Backend 'AI');AI",
            "--add-binary","$script:Ffmpeg;.",
            "--hidden-import","run_all",
            "--collect-submodules","omegaconf",
            "--collect-submodules","ml_collections",
            "--collect-submodules","beartype",
            "--collect-submodules","rotary_embedding_torch",
            "--collect-submodules","matplotlib",
            "run.py"
        )

        & $Python @args

        if ($LASTEXITCODE -ne 0) {
            throw "KaraokeBackend PyInstaller build failed."
        }

        Restore-PackagedAI

        Write-Host ""
        Write-Host "Building KaraokeAudioMonitor.exe..."
        Write-Host ""

        $monitorArgs = @(
            "-m","PyInstaller",
            "--log-level","ERROR",
            "--noconfirm"
        )

        if ($Mode -eq "clean") {
            $monitorArgs += "--clean"
        }

        $monitorArgs += @(
            "--onefile",
            "--name","KaraokeAudioMonitor",
            "--distpath",$BackendDist,
            "--workpath",(Join-Path $Build "backend\audio-monitor"),
            "--specpath",(Join-Path $Build "backend\spec"),
            "--paths",$Backend,
            "app\services\monitor_worker.py"
        )

        & $Python @monitorArgs

        if ($LASTEXITCODE -ne 0) {
            throw "KaraokeAudioMonitor build failed."
        }
    }
    finally {
        Pop-Location
    }

    Require-File (Join-Path $BackendDist "KaraokeBackend.exe") "KaraokeBackend.exe"
    Require-File (Join-Path $BackendDist "KaraokeAudioMonitor.exe") "KaraokeAudioMonitor.exe"
}

function Build-Asio {
    Write-Host ""
    Write-Host "[3/6] Compiling native ASIO bridge..."

    New-Item -ItemType Directory -Path $AsioBuild -Force | Out-Null

    $cmd = @"
call "$VcVars" >nul && "$CMake" -S "$Asio" -B "$AsioBuild" -G Ninja -DCMAKE_BUILD_TYPE=Release -DASIO_SDK_DIR="$AsioSdk" -DCMAKE_MAKE_PROGRAM="$Ninja" && "$CMake" --build "$AsioBuild" --parallel
"@

    & cmd.exe /D /S /C $cmd

    if ($LASTEXITCODE -ne 0) {
        throw "ASIO compilation failed."
    }

    Require-File (Join-Path $AsioBuild "KaraokeAsioBridge.exe") "Compiled KaraokeAsioBridge.exe"
}

function Sign-File([string]$Path) {
    Require-File $SignScript "Signing script"

    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $SignScript -Path $Path

    if ($LASTEXITCODE -ne 0) {
        throw "Code signing failed for: $Path"
    }
}

function Finalize-Asio {
    Write-Host ""
    Write-Host "Finalizing ASIO bridge and signing backend executables..."

    $bridge = Join-Path $AsioBuild "KaraokeAsioBridge.exe"

    Require-File $bridge "Compiled KaraokeAsioBridge.exe"
    Require-Directory $BackendDist "Packaged backend directory"

    Copy-Item -LiteralPath $bridge -Destination (Join-Path $BackendDist "KaraokeAsioBridge.exe") -Force

    Sign-File (Join-Path $BackendDist "KaraokeBackend.exe")
    Sign-File (Join-Path $BackendDist "KaraokeAudioMonitor.exe")
    Sign-File (Join-Path $BackendDist "KaraokeAsioBridge.exe")
}

function Get-TreeSignature([string]$Path) {
    $root = [IO.Path]::GetFullPath($Path).TrimEnd('\')

    return @(
        Get-ChildItem -LiteralPath $root -Recurse -File -Force -ErrorAction SilentlyContinue |
        Where-Object {
            -not (Test-ExcludedPath $_.FullName `
                @(".cache",".git","__pycache__") `
                @("*.metadata","*.lock","*.tmp","*.part"))
        } |
        ForEach-Object {
            $rel = $_.FullName.Substring($root.Length).TrimStart('\').ToLowerInvariant()
            $sec = [int64]($_.LastWriteTimeUtc.Ticks / 10000000)
            "$rel|$($_.Length)|$sec"
        } |
        Sort-Object
    )
}

function Trees-Equal([string]$Source, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Destination -PathType Container)) {
        return $false
    }

    $a = Get-TreeSignature $Source
    $b = Get-TreeSignature $Destination

    if ($a.Count -ne $b.Count) { return $false }

    for ($i = 0; $i -lt $a.Count; $i++) {
        if ($a[$i] -cne $b[$i]) { return $false }
    }

    return $true
}

function Sync-DirectoryIfChanged(
    [string]$Source,
    [string]$Destination,
    [string]$Label
) {
    Require-Directory $Source $Label

    if (Trees-Equal $Source $Destination) {
        Remove-IgnoredPayloadFiles $Destination
        Write-Host "  ${Label}: unchanged [skip]"
        return
    }

    if (Test-Path -LiteralPath $Destination) {
        Write-Host "  ${Label}: changed - synchronizing..."
    }
    else {
        Write-Host "  ${Label}: new - synchronizing..."
        New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    }

    & robocopy.exe $Source $Destination `
        /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:1 /MT:16 /J `
        /XD ".cache" ".git" "__pycache__" `
        /XF "*.metadata" "*.lock" "*.tmp" "*.part" `
        /NFL /NDL /NJH /NJS /NP

    $rc = $LASTEXITCODE

    if ($rc -ge 8) {
        throw "Failed to synchronize $Label. Robocopy exit code: $rc"
    }

    Remove-IgnoredPayloadFiles $Destination

    if (-not (Trees-Equal $Source $Destination)) {
        throw "$Label still differs after synchronization."
    }

    Write-Host "  ${Label}: synchronized"
}

function Verify-ModelTree([string]$Destination, [string]$Label) {
    Require-Directory $Models "Offline AI models directory"
    Require-Directory $Destination $Label

    $source = Get-TreeSignature $Models
    $target = Get-TreeSignature $Destination

    if ($source.Count -ne $target.Count) {
        throw "Model file count differs after cache exclusion: source=$($source.Count), packaged=$($target.Count)"
    }

    for ($i = 0; $i -lt $source.Count; $i++) {
        if ($source[$i] -cne $target[$i]) {
            throw "Packaged model tree differs from downloads\models."
        }
    }

    $bytes = [int64]0
    Get-ChildItem -LiteralPath $Destination -Recurse -File -Force -ErrorAction SilentlyContinue |
        Where-Object {
            -not (Test-ExcludedPath $_.FullName `
                @(".cache",".git","__pycache__") `
                @("*.metadata","*.lock","*.tmp","*.part"))
        } |
        ForEach-Object { $bytes += $_.Length }

    $gb = [Math]::Round($bytes / 1GB, 2)
    Write-Host "  Model tree verified: $($target.Count) files, $gb GB (cache excluded)."
}

function Sync-ModelTree {
    $modelDest = Join-Path $BackendDist "_internal\models"
    New-Item -ItemType Directory -Path $modelDest -Force | Out-Null

    foreach ($dir in Get-ChildItem -LiteralPath $Models -Directory -Force) {
        if ($dir.Name -in @(".cache",".git","__pycache__")) { continue }

        Sync-DirectoryIfChanged `
            $dir.FullName `
            (Join-Path $modelDest $dir.Name) `
            "AI model $($dir.Name)"
    }

    foreach ($file in Get-ChildItem -LiteralPath $Models -File -Force) {
        if ($file.Name -like "*.metadata" -or
            $file.Name -like "*.lock" -or
            $file.Name -like "*.tmp" -or
            $file.Name -like "*.part") { continue }

        $target = Join-Path $modelDest $file.Name
        $copy = $true

        if (Test-Path -LiteralPath $target -PathType Leaf) {
            $existing = Get-Item -LiteralPath $target -Force
            $srcSec = [int64]($file.LastWriteTimeUtc.Ticks / 10000000)
            $dstSec = [int64]($existing.LastWriteTimeUtc.Ticks / 10000000)
            $copy = $existing.Length -ne $file.Length -or $srcSec -ne $dstSec
        }

        if ($copy) {
            Write-Host "  Updating model file: $($file.Name)"
            Copy-Item -LiteralPath $file.FullName -Destination $target -Force
            (Get-Item -LiteralPath $target -Force).LastWriteTimeUtc = $file.LastWriteTimeUtc
        }
        else {
            Write-Host "  Model file $($file.Name): unchanged [skip]"
        }
    }

    foreach ($item in Get-ChildItem -LiteralPath $modelDest -Force) {
        $sourceItem = Join-Path $Models $item.Name

        if (-not (Test-Path -LiteralPath $sourceItem) -or
            $item.Name -in @(".cache",".git","__pycache__")) {
            Write-Host "  Removing stale packaged model: $($item.Name)"
            Remove-Item -LiteralPath $item.FullName -Recurse -Force
        }
    }

    Remove-IgnoredPayloadFiles $modelDest
    Verify-ModelTree $modelDest "Packaged AI models"
}

function Verify-BackendBase {
    Require-File (Join-Path $BackendDist "KaraokeBackend.exe") "KaraokeBackend.exe"
    Require-File (Join-Path $BackendDist "KaraokeAudioMonitor.exe") "KaraokeAudioMonitor.exe"
    Require-File (Join-Path $BackendDist "KaraokeAsioBridge.exe") "KaraokeAsioBridge.exe"
    Require-Directory (Join-Path $BackendDist "_internal") "PyInstaller internal directory"
}

function Verify-BackendDist {
    Verify-BackendBase

    $modelDir = Join-Path $BackendDist "_internal\models"
    Require-Directory $modelDir "Packaged AI models directory"
    Verify-ModelTree $modelDir "Packaged backend AI models"

    Require-File `
        (Join-Path $BackendDist "_internal\engines\msst\inference.py") `
        "Packaged MSST engine"
}

function Package-Models {
    Write-Host ""
    Write-Host "[4/6] Checking offline AI model folders..."

    $internal = Join-Path $BackendDist "_internal"

    Require-Directory $internal "PyInstaller internal directory"
    Require-Directory $Models "Offline AI models directory"

    $modelDest = Join-Path $internal "models"
    New-Item -ItemType Directory -Path $modelDest -Force | Out-Null

    Write-Host ""
    Write-Host "Models source:"
    Write-Host "  $Models"
    Write-Host ""
    Write-Host "Model destination:"
    Write-Host "  $modelDest"
    Write-Host ""
    Write-Host "Any new first-level model folder is detected automatically."
    Write-Host "Existing unchanged folders remain exactly where they are."
    Write-Host "Unchanged folders are skipped completely."
    Write-Host "Changed folders are synchronized individually."
    Write-Host "Only changed files inside a changed folder are copied."
    Write-Host ""

    Sync-ModelTree

    $msstDest = Join-Path $internal "engines\msst"
    Sync-DirectoryIfChanged $MsstEngine $msstDest "MSST inference engine"

    Verify-BackendDist
}

function Build-Frontend {
    Write-Host ""
    Write-Host "[5/6] Building React frontend..."

    Push-Location $Frontend

    try {
        & $script:NpmCmd run build

        if ($LASTEXITCODE -ne 0) {
            throw "React frontend build failed."
        }
    }
    finally {
        Pop-Location
    }
}

function Verify-Unpacked {
    Require-File (Join-Path $Unpacked $AppExe) "Electron application"
    Require-File $PackagedSceneVideo "Karaoke scene video"
    Require-File (Join-Path $PackagedBackend "KaraokeBackend.exe") "Electron backend"
    Require-File (Join-Path $PackagedBackend "KaraokeAudioMonitor.exe") "Electron audio monitor"
    Require-File (Join-Path $PackagedBackend "KaraokeAsioBridge.exe") "Electron ASIO bridge"

    if (Test-Path -LiteralPath (Join-Path $PackagedBackend "_internal\models")) {
        throw "Electron package unexpectedly contains AI models."
    }

    if (Test-Path -LiteralPath (Join-Path $PackagedBackend "_internal\engines\msst")) {
        throw "Electron package unexpectedly contains MSST."
    }
}

function Move-HeavyAIOutOfBackend {
    New-Item -ItemType Directory -Path $ExternalPayload -Force | Out-Null

    $modelsPath = Join-Path $BackendDist "_internal\models"
    $msstPath = Join-Path $BackendDist "_internal\engines\msst"

    Remove-Directory $ExternalModels
    Remove-Directory $ExternalMsst

    if (Test-Path -LiteralPath $modelsPath -PathType Container) {
        Move-Item -LiteralPath $modelsPath -Destination $ExternalModels
    }

    if (Test-Path -LiteralPath $msstPath -PathType Container) {
        New-Item -ItemType Directory -Path (Split-Path $ExternalMsst -Parent) -Force | Out-Null
        Move-Item -LiteralPath $msstPath -Destination $ExternalMsst
    }
}

function Restore-HeavyAIToBackend {
    $modelsPath = Join-Path $BackendDist "_internal\models"
    $enginesPath = Join-Path $BackendDist "_internal\engines"
    $msstPath = Join-Path $enginesPath "msst"

    if (Test-Path -LiteralPath $ExternalModels -PathType Container) {
        New-Item -ItemType Directory -Path (Split-Path $modelsPath -Parent) -Force | Out-Null
        if (Test-Path -LiteralPath $modelsPath) { Remove-Directory $modelsPath }
        Move-Item -LiteralPath $ExternalModels -Destination $modelsPath
    }

    if (Test-Path -LiteralPath $ExternalMsst -PathType Container) {
        New-Item -ItemType Directory -Path $enginesPath -Force | Out-Null
        if (Test-Path -LiteralPath $msstPath) { Remove-Directory $msstPath }
        Move-Item -LiteralPath $ExternalMsst -Destination $msstPath
    }
}

function Add-SmokeTestJunctions {
    $internal = Join-Path $PackagedBackend "_internal"
    $modelsLink = Join-Path $internal "models"
    $engines = Join-Path $internal "engines"
    $msstLink = Join-Path $engines "msst"

    New-Item -ItemType Directory -Path $internal -Force | Out-Null
    New-Item -ItemType Directory -Path $engines -Force | Out-Null

    & cmd.exe /D /C "mklink /J `"$modelsLink`" `"$Models`"" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not create model junction for smoke test." }

    & cmd.exe /D /C "mklink /J `"$msstLink`" `"$MsstEngine`"" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not create MSST junction for smoke test." }

    return @($modelsLink,$msstLink)
}

function Remove-SmokeTestJunctions([string[]]$Links) {
    foreach ($link in $Links) {
        if (Test-Path -LiteralPath $link) {
            & cmd.exe /D /C "rmdir `"$link`"" | Out-Null
        }
    }
}

function Build-ElectronPackage {
    Write-Host ""
    Write-Host "[5/7] Building complete Electron application..."

    Require-File $SceneVideoSource "Karaoke scene video"

    Move-HeavyAIOutOfBackend

    try {
        Remove-Directory $Unpacked

        Push-Location $Frontend
        try {
            Write-Host ""
            Write-Host "Building Electron win-unpacked WITHOUT AI models..."
            Write-Host ""

            & $script:NpxCmd electron-builder --win --x64 --dir

            if ($LASTEXITCODE -ne 0) {
                throw "Electron win-unpacked build failed."
            }
        }
        finally {
            Pop-Location
        }
    }
    finally {
        Restore-HeavyAIToBackend
    }

    Sign-File (Join-Path $Unpacked $AppExe)
    Verify-Unpacked

    Write-Host ""
    Write-Host "Running packaged backend + AI runtime smoke test..."
    Write-Host ""

    Require-File $SmokeScript "Packaged backend smoke test"
    $links = Add-SmokeTestJunctions

    try {
        & powershell.exe `
            -NoProfile `
            -ExecutionPolicy Bypass `
            -File $SmokeScript `
            -Executable (Join-Path $PackagedBackend "KaraokeBackend.exe")

        if ($LASTEXITCODE -ne 0) {
            throw "Packaged backend runtime smoke test failed."
        }
    }
    finally {
        Remove-SmokeTestJunctions $links
    }

    Verify-Unpacked
    Write-Host ""
    Write-Host "Electron package verified successfully; AI stays external."
}

function Find-Inno {
    if ($env:INNO_COMPILER_OVERRIDE -and (Test-Path -LiteralPath $env:INNO_COMPILER_OVERRIDE -PathType Leaf)) {
        return $env:INNO_COMPILER_OVERRIDE
    }

    $candidates = @(
        (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe"),
        (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 7\ISCC.exe"),
        (Join-Path $env:ProgramFiles "Inno Setup 7\ISCC.exe")
    )

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return $candidate
        }
    }

    foreach ($key in @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1"
    )) {
        try {
            $location = (Get-ItemProperty -LiteralPath $key -ErrorAction Stop).InstallLocation

            if ($location) {
                $candidate = Join-Path $location "ISCC.exe"

                if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                    return $candidate
                }
            }
        }
        catch {
        }
    }

    return $null
}

function Build-Installer {
    Write-Host ""
    Write-Host "[6/6] Building complete offline installer..."

    $inno = Find-Inno

    if (-not $inno) {
        throw "Inno Setup compiler was not found. Install Inno Setup 6."
    }

    Write-Host ""
    Write-Host "Inno Setup:"
    Write-Host "  $inno"
    Write-Host ""

    Remove-Directory $InstallerDir
    Remove-Directory $TempDir

    New-Item -ItemType Directory -Path $InstallerDir -Force | Out-Null
    New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

    & $inno `
        "/DMyAppName=$AppName" `
        "/DMyAppVersion=$AppVersion" `
        "/DMyAppExeName=$AppExe" `
        "/DMyAppId=$AppId" `
        "/DSetupIcon=$SetupIcon" `
        "/DSourceDir=$Unpacked" `
        "/DOutputDir=$InstallerDir" `
        $InnoTemplate

    if ($LASTEXITCODE -ne 0) {
        throw "Inno Setup compilation failed."
    }

    Require-File $InstallerExe "Installer executable"
    Sign-File $InstallerExe

    $bins = @(Get-ChildItem -LiteralPath $InstallerDir -Filter "*.bin" -File -ErrorAction SilentlyContinue)

    if ($bins.Count -eq 0) {
        throw "Installer .bin data files were not created."
    }
}

function Create-Checksums {
    Write-Host ""
    Write-Host "Creating SHA-256 checksums..."

    Require-File $ChecksumScript "Checksum generation script"

    & powershell.exe `
        -NoProfile `
        -ExecutionPolicy Bypass `
        -File $ChecksumScript `
        -InstallerDirectory $InstallerDir `
        -OutputFile $ChecksumFile

    if ($LASTEXITCODE -ne 0) {
        throw "Could not create SHA-256 checksums."
    }

    Require-File $ChecksumFile "SHA-256 checksum file"
}

function Create-DistributionIso {
    Write-Host ""
    Write-Host "[7/7] Creating single-file distribution ISO..."
    Write-Host ""

    if (-not $script:Oscdimg) {
        $script:Oscdimg = Find-Oscdimg
    }

    Require-File $InstallerExe "Installer executable"
    Require-File $ChecksumFile "SHA-256 checksum file"

    New-Item -ItemType Directory -Path $IsoStage -Force | Out-Null

    # Only top-level setup/checksum files are refreshed here. The very large
    # model/MSST trees remain in persistent staging and are synchronized below.
    Get-ChildItem -LiteralPath $IsoStage -File -Force -ErrorAction SilentlyContinue |
        Remove-Item -Force

    Get-ChildItem -LiteralPath $InstallerDir -File -Force |
        ForEach-Object {
            Copy-Item `
                -LiteralPath $_.FullName `
                -Destination (Join-Path $IsoStage $_.Name) `
                -Force
        }

    Sync-DirectoryIfChanged `
        $Models `
        (Join-Path $IsoStage "models") `
        "ISO AI models"

    Sync-DirectoryIfChanged `
        $MsstEngine `
        (Join-Path $IsoStage "msst") `
        "ISO MSST engine"

    Remove-IgnoredPayloadFiles (Join-Path $IsoStage "models")
    Remove-IgnoredPayloadFiles (Join-Path $IsoStage "msst")

    if (Test-Path -LiteralPath $IsoTemp -PathType Leaf) {
        Remove-Item -LiteralPath $IsoTemp -Force
    }

    $volume = ("ADVOICE_" + $AppVersion.Replace(".","_")).ToUpperInvariant()

    if ($volume.Length -gt 32) {
        $volume = $volume.Substring(0,32)
    }

    Write-Host ""
    Write-Host "Creating ISO from:"
    Write-Host "  $IsoStage"
    Write-Host ""

    New-DistributionIsoImage `
        -SourceDirectory $IsoStage `
        -OutputFile $IsoTemp `
        -VolumeName $volume

    Require-File $IsoTemp "Distribution ISO"

    $isoInfo = Get-Item -LiteralPath $IsoTemp

    if ($isoInfo.Length -le 0) {
        throw "Created ISO is empty."
    }

    New-Item -ItemType Directory -Path $Release -Force | Out-Null

    Get-ChildItem -LiteralPath $Release -Force -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

    Move-Item -LiteralPath $IsoTemp -Destination $IsoFile -Force

    Require-File $IsoFile "Final distribution ISO"

    Write-Host ""
    Write-Host ("ISO size: {0:N2} GB" -f ((Get-Item -LiteralPath $IsoFile).Length / 1GB))
    Write-Host ""
    Write-Host "Single-file distribution ready:"
    Write-Host "  $IsoFile"
    Write-Host ""
}

function Start-WorkerProcess([string]$Name) {
    $outLog = Join-Path $ParallelDir "$Name.out.log"
    $errLog = Join-Path $ParallelDir "$Name.err.log"
    $exitFile = Join-Path $ParallelDir "$Name.exit"

    Remove-Item -LiteralPath $outLog,$errLog,$exitFile -Force -ErrorAction SilentlyContinue

    $args = @(
        "-NoProfile",
        "-ExecutionPolicy","Bypass",
        "-File",$PSCommandPath,
        "-Mode",$Mode,
        "-Worker",$Name
    )

    return Start-Process `
        -FilePath "powershell.exe" `
        -ArgumentList $args `
        -RedirectStandardOutput $outLog `
        -RedirectStandardError $errLog `
        -PassThru `
        -NoNewWindow
}

function Run-Parallel([string[]]$Workers) {
    if (Test-Path -LiteralPath $ParallelDir) {
        Remove-Directory $ParallelDir
    }

    New-Item -ItemType Directory -Path $ParallelDir -Force | Out-Null

    $processes = @{}
    $last = @{}

    foreach ($name in $Workers) {
        $processes[$name] = Start-WorkerProcess $name
    }

    while ($true) {
        $allDone = $true

        foreach ($name in $Workers) {
            $exitFile = Join-Path $ParallelDir "$name.exit"

            if (-not (Test-Path -LiteralPath $exitFile -PathType Leaf)) {
                $allDone = $false
            }

            $outLog = Join-Path $ParallelDir "$name.out.log"
            $errLog = Join-Path $ParallelDir "$name.err.log"
            $lines = @()

            if (Test-Path -LiteralPath $outLog) {
                $lines += @(Get-Content -LiteralPath $outLog -Tail 2 -ErrorAction SilentlyContinue)
            }

            if (Test-Path -LiteralPath $errLog) {
                $lines += @(Get-Content -LiteralPath $errLog -Tail 2 -ErrorAction SilentlyContinue)
            }

            $lines = @(
                $lines |
                Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
                Select-Object -Last 2
            )

            if ($lines.Count -gt 0) {
                $joined = $lines -join " | "

                if (-not $last.ContainsKey($name) -or $last[$name] -ne $joined) {
                    Write-Host "  $name`: $joined"
                    $last[$name] = $joined
                }
            }

            $proc = $processes[$name]
            if ($proc.HasExited -and -not (Test-Path -LiteralPath $exitFile)) {
                "1" | Set-Content -LiteralPath $exitFile -Encoding ASCII
            }
        }

        if ($allDone) {
            break
        }

        Start-Sleep -Seconds 3
    }

    $failed = $false

    foreach ($name in $Workers) {
        $proc = $processes[$name]
        try { $proc.WaitForExit() } catch {}

        $exitFile = Join-Path $ParallelDir "$name.exit"
        $code = 1

        if (Test-Path -LiteralPath $exitFile) {
            $raw = (Get-Content -LiteralPath $exitFile -ErrorAction SilentlyContinue | Select-Object -First 1)

            if ($raw -match '^[0-9]+$') {
                $code = [int]$raw
            }
        }

        if ($code -ne 0) {
            $failed = $true
            Write-Host ""
            Write-Host "[ERROR] Parallel worker failed: $name"
            Write-Host "Exit code: $code"

            $outLog = Join-Path $ParallelDir "$name.out.log"
            $errLog = Join-Path $ParallelDir "$name.err.log"

            if (Test-Path -LiteralPath $outLog) {
                Get-Content -LiteralPath $outLog
            }

            if (Test-Path -LiteralPath $errLog) {
                Get-Content -LiteralPath $errLog
            }
        }
        else {
            Write-Host "[OK] Parallel worker: $name"
        }
    }

    if ($failed) {
        throw "Parallel build stage failed."
    }
}

function Parallel-FullBuild {
    Write-Header "SMART PARALLEL BUILD"

    $force = ($Mode -eq "clean")

    $script:BackendFingerprint = Get-BackendFingerprint
    $script:AsioFingerprint = Get-AsioFingerprint
    $script:FrontendFingerprint = Get-FrontendFingerprint

    $script:BackendChanged = Test-StepNeeded `
        "backend" `
        $script:BackendFingerprint `
        @(
            (Join-Path $BackendDist "KaraokeBackend.exe"),
            (Join-Path $BackendDist "KaraokeAudioMonitor.exe")
        ) `
        -Force:$force

    $script:AsioChanged = Test-StepNeeded `
        "asio" `
        $script:AsioFingerprint `
        @((Join-Path $AsioBuild "KaraokeAsioBridge.exe")) `
        -Force:$force

    $script:FrontendChanged = Test-StepNeeded `
        "frontend" `
        $script:FrontendFingerprint `
        @((Join-Path $Build "frontend\dist\index.html")) `
        -Force:$force

    $workers = @()
    if ($script:BackendChanged) { $workers += "backend" }
    if ($script:AsioChanged) { $workers += "asio" }
    if ($script:FrontendChanged) { $workers += "frontend" }

    if ($workers.Count -eq 0) {
        Write-Host ""
        Write-Host "Backend, ASIO and frontend are unchanged. Nothing to rebuild."
        return
    }

    Write-Host ""
    Write-Host "Running changed steps simultaneously:"
    foreach ($worker in $workers) { Write-Host "  - $worker" }
    Write-Host ""

    Run-Parallel $workers

    if ($script:BackendChanged) { Set-State "backend" $script:BackendFingerprint }
    if ($script:AsioChanged) { Set-State "asio" $script:AsioFingerprint }
    if ($script:FrontendChanged) { Set-State "frontend" $script:FrontendFingerprint }

    Write-Host ""
    Write-Host "Smart parallel build completed."
}

function Parallel-FastBuild {
    Write-Host ""
    Write-Host "Fast mode now uses the same smart incremental pipeline."
    Parallel-FullBuild
}

function Initialize-WorkerCommands {
    $script:NodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    $script:NpmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    $script:NpxCmd = (Get-Command npx.cmd -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    $script:Ffmpeg = (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source
}

try {
    if ($Worker) {
        Initialize-WorkerCommands
        New-Item -ItemType Directory -Path $ParallelDir -Force | Out-Null

        $workerExitFile = Join-Path $ParallelDir "$Worker.exit"
        $workerCode = 0

        try {
            switch ($Worker) {
                "backend" {
                    Build-Backend
                }
                "asio" {
                    Build-Asio
                }
                "frontend" {
                    Build-Frontend
                }
                "package-models" {
                    Package-Models
                }
            }
        }
        catch {
            $workerCode = 1
            Write-Host ""
            Write-Host ("=" * 60)
            Write-Host " BUILD FAILED"
            Write-Host ("=" * 60)
            Write-Host ""
            Write-Host "[ERROR] $($_.Exception.Message)"
            Write-Host ""

            if ($_.ScriptStackTrace) {
                Write-Host "PowerShell stack:"
                Write-Host $_.ScriptStackTrace
                Write-Host ""
            }
        }
        finally {
            $workerCode.ToString() | Set-Content -LiteralPath $workerExitFile -Encoding ASCII
        }

        exit $workerCode
    }

    Write-Header "A&D VOICE - COMPLETE OFFLINE INSTALLER"

    Write-Host "Build mode:"
    Write-Host "  $Mode"
    Write-Host ""
    Write-Host "Project:"
    Write-Host "  $Root"
    Write-Host ""
    Write-Host "Build intermediates:"
    Write-Host "  $Build"
    Write-Host ""
    Write-Host "Downloaded resources:"
    Write-Host "  $Downloads"
    Write-Host ""
    Write-Host "Final release:"
    Write-Host "  $Release"
    Write-Host ""

    Stop-BuildProcesses
    Check-Environment
    Prepare-Output

    if ($Mode -eq "installer") {
        Write-Header "INSTALLER / ISO ONLY"
        Verify-Unpacked
    }
    else {
        Check-Models
        Parallel-FullBuild

        $needFinalize = $script:BackendChanged -or $script:AsioChanged -or `
            -not (Test-Path -LiteralPath (Join-Path $BackendDist "KaraokeAsioBridge.exe"))

        if ($needFinalize) {
            Finalize-Asio
        }
        else {
            Write-Host "  backend signing / ASIO finalize: unchanged [skip]"
        }

        $script:ModelsFingerprint = Get-ModelsFingerprint
        $modelsOutput = Join-Path $BackendDist "_internal\models"
        $msstOutput = Join-Path $BackendDist "_internal\engines\msst\inference.py"

        $script:ModelsChanged = Test-StepNeeded `
            "models" `
            $script:ModelsFingerprint `
            @($modelsOutput,$msstOutput) `
            -Force:(($Mode -eq "clean") -or $script:BackendChanged)

        if ($script:ModelsChanged) {
            Package-Models
            Set-State "models" $script:ModelsFingerprint
        }

        $electronFp = Get-ElectronFingerprint
        $electronNeeded = Test-StepNeeded `
            "electron" `
            $electronFp `
            @(
                (Join-Path $Unpacked $AppExe),
                (Join-Path $PackagedBackend "KaraokeBackend.exe"),
                (Join-Path $PackagedBackend "KaraokeAsioBridge.exe")
            ) `
            -Force:($Mode -eq "clean")

        if ($electronNeeded) {
            Build-ElectronPackage
            Set-State "electron" $electronFp
        }
    }

    $installerFp = Get-InstallerFingerprint
    $installerNeeded = Test-StepNeeded `
        "installer" `
        $installerFp `
        @($InstallerExe) `
        -Force:($Mode -eq "clean")

    if ($installerNeeded) {
        Build-Installer
        Create-Checksums
        Set-State "installer" $installerFp
    }
    elseif (-not (Test-Path -LiteralPath $ChecksumFile -PathType Leaf)) {
        Create-Checksums
    }

    $modelsFpForIso = Get-ModelsFingerprint
    $installerPayloadFp = Get-Fingerprint @($InstallerDir) @(".cache",".git") @("*.tmp")
    $isoFp = Get-CombinedFingerprint @($installerPayloadFp,$modelsFpForIso,$AppVersion)

    $isoNeeded = Test-StepNeeded `
        "iso" `
        $isoFp `
        @($IsoFile) `
        -Force:($Mode -eq "clean")

    if ($isoNeeded) {
        Create-DistributionIso
        Set-State "iso" $isoFp
    }

    Remove-Directory $TempDir

    Write-Header "BUILD COMPLETED SUCCESSFULLY"

    Write-Host "Single-file offline distribution:"
    Write-Host "  $IsoFile"
    Write-Host ""
    Write-Host "The ISO contains Setup.exe, all Setup-*.bin files,"
    Write-Host "and SHA256SUMS.txt. Mount the ISO and run Setup.exe."
    Write-Host ""

    Start-Process explorer.exe $InstallerDir
    exit 0
}
catch {
    Write-Host ""
    Write-Host ("=" * 60)
    Write-Host " BUILD FAILED"
    Write-Host ("=" * 60)
    Write-Host ""
    Write-Host "[ERROR] $($_.Exception.Message)"
    Write-Host ""

    if ($_.ScriptStackTrace) {
        Write-Host "PowerShell stack:"
        Write-Host $_.ScriptStackTrace
        Write-Host ""
    }

    exit 1
}
