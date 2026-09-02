param(
    [Parameter(Mandatory = $true)]
    [string] $Directory,

    [string] $OutputFile = ""
)

# Buckets every file under a packaged build directory into the size
# contributors from the tech-debt doc's "size report" task, and separately
# flags byte-identical duplicates. Ordering matters: the first pattern whose
# regex matches a file's path (relative to $Directory, forward slashes)
# claims it, so more specific buckets are listed before generic ones.
$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $Directory -PathType Container)) {
    throw "Directory not found: $Directory"
}

function Get-Sha256Hex([string]$Path) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try {
        return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace("-", "")
    }
    finally {
        $stream.Dispose()
        $algorithm.Dispose()
    }
}

$buckets = [ordered]@{
    "models"             = '(^|/)(models|AI[/\\](models|checkpoints))(/|$)'
    "Python packages"    = '(^|/)resources/backend(/|$)'
    "native DLL"         = '\.(dll|pyd|so)$'
    "frontend chunks"    = '(^|/)resources/app(\.asar(\.unpacked)?)?(/|$)'
    "Electron runtime"   = '(^|/)(locales|resources/media)(/|$)|\.(pak|bin|dat)$|^[^/]+\.exe$'
    "assets"             = '\.(ico|png|jpg|jpeg|svg|webm|mp4|woff2?|ttf)$'
}
$bucketOrder = @($buckets.Keys) + @("other")
$totals = [ordered]@{}
foreach ($name in $bucketOrder) { $totals[$name] = [PSCustomObject]@{ Count = 0; Bytes = [int64]0 } }

$hashGroups = @{}

$files = Get-ChildItem -LiteralPath $Directory -File -Recurse -Force
foreach ($file in $files) {
    $relative = $file.FullName.Substring($Directory.TrimEnd('\', '/').Length + 1) -replace '\\', '/'

    $bucket = "other"
    foreach ($name in $buckets.Keys) {
        if ($relative -match $buckets[$name]) { $bucket = $name; break }
    }
    $totals[$bucket].Count += 1
    $totals[$bucket].Bytes += $file.Length

    # Only worth hashing files large enough for a duplicate to matter --
    # skip tiny files to keep this fast on a full packaged tree.
    if ($file.Length -gt 4096) {
        $hash = Get-Sha256Hex $file.FullName
        if (-not $hashGroups.ContainsKey($hash)) { $hashGroups[$hash] = New-Object System.Collections.Generic.List[object] }
        $hashGroups[$hash].Add([PSCustomObject]@{ Path = $relative; Bytes = $file.Length })
    }
}

$duplicateGroups = @(
    $hashGroups.GetEnumerator() |
    Where-Object { $_.Value.Count -gt 1 } |
    ForEach-Object {
        [PSCustomObject]@{
            Paths        = @($_.Value | ForEach-Object { $_.Path })
            BytesEach    = $_.Value[0].Bytes
            WastedBytes  = $_.Value[0].Bytes * ($_.Value.Count - 1)
        }
    } |
    Sort-Object -Property WastedBytes -Descending
)

$report = [ordered]@{
    directory        = $Directory
    totalBytes       = ($totals.Values | ForEach-Object { $_.Bytes } | Measure-Object -Sum).Sum
    contributors     = @(
        $bucketOrder |
        Where-Object { $totals[$_].Count -gt 0 } |
        ForEach-Object { [ordered]@{ category = $_; files = $totals[$_].Count; bytes = $totals[$_].Bytes } } |
        Sort-Object -Property bytes -Descending
    )
    duplicateFiles   = @(
        $duplicateGroups | ForEach-Object {
            [ordered]@{ paths = $_.Paths; bytesEach = $_.BytesEach; wastedBytes = $_.WastedBytes }
        }
    )
}

function Format-Bytes([int64]$Bytes) {
    "{0:N1} MB" -f ($Bytes / 1MB)
}

Write-Host ""
Write-Host "Size report for $Directory"
Write-Host ("Total: {0}" -f (Format-Bytes $report.totalBytes))
Write-Host ""
foreach ($entry in $report.contributors) {
    Write-Host ("  {0,-20} {1,10}  ({2} files)" -f $entry.category, (Format-Bytes $entry.bytes), $entry.files)
}
if ($duplicateGroups.Count -gt 0) {
    $wastedTotal = ($duplicateGroups | ForEach-Object { $_.WastedBytes } | Measure-Object -Sum).Sum
    Write-Host ""
    Write-Host ("Duplicate files: {0} group(s), {1} wasted" -f $duplicateGroups.Count, (Format-Bytes $wastedTotal))
    foreach ($group in ($duplicateGroups | Select-Object -First 10)) {
        Write-Host ("  {0} x{1}: {2}" -f (Format-Bytes $group.WastedBytes), $group.Paths.Count, ($group.Paths -join ", "))
    }
}

if ($OutputFile) {
    $json = $report | ConvertTo-Json -Depth 6
    $utf8WithoutBom = [Text.UTF8Encoding]::new($false)
    [IO.File]::WriteAllText($OutputFile, $json, $utf8WithoutBom)
    Write-Host ""
    Write-Host "Wrote $OutputFile"
}
