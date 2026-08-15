param(
    [Parameter(Mandatory=$true, Position=0)][string]$Baseline,
    [Parameter(Mandatory=$true, Position=1)][string]$Candidate
)

$ErrorActionPreference = "Stop"

function Load-Perf([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "performance.json not found: $Path"
    }
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Stage-Time($Perf, [string]$Name) {
    $stage = $Perf.stages | Where-Object { $_.name -eq $Name -or $_.stage -eq $Name } | Select-Object -First 1
    if ($null -eq $stage) { return $null }
    foreach ($field in @("elapsed_sec", "duration_sec", "seconds")) {
        if ($null -ne $stage.$field) { return [double]$stage.$field }
    }
    return $null
}

function Op-Time($Perf, [string]$Name) {
    $property = $Perf.operations.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return [double]$property.Value.elapsed_sec
}

function Row([string]$Name, $Before, $After) {
    if ($null -eq $Before -or $null -eq $After) { return }
    $delta = if ($Before -gt 0) { 100.0 * ($After - $Before) / $Before } else { 0 }
    [PSCustomObject]@{
        Metric = $Name
        BaselineSec = [math]::Round($Before, 3)
        TunedSec = [math]::Round($After, 3)
        ChangePercent = [math]::Round($delta, 2)
        Speedup = if ($After -gt 0) { [math]::Round($Before / $After, 3) } else { $null }
    }
}

$a = Load-Perf $Baseline
$b = Load-Perf $Candidate
$rows = @()
$rows += Row "Full pipeline" ([double]$a.elapsed_sec) ([double]$b.elapsed_sec)
$rows += Row "Separation inference" (Op-Time $a "separation.inference") (Op-Time $b "separation.inference")
foreach ($name in @("separation", "pitch", "asr", "alignment")) {
    $rows += Row $name (Stage-Time $a $name) (Stage-Time $b $name)
}
$rows | Where-Object { $null -ne $_ } | Format-Table -AutoSize
