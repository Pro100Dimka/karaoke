param(
    [Parameter(Mandatory = $true)]
    [string[]] $Path
)

$ErrorActionPreference = "Stop"
$certificate = $env:ADVOICE_SIGN_PFX
$password = $env:ADVOICE_SIGN_PASSWORD
$required = $env:ADVOICE_REQUIRE_SIGNING -eq "1"

if (-not $certificate) {
    if ($required) {
        throw "ADVOICE_REQUIRE_SIGNING=1, but ADVOICE_SIGN_PFX is not configured."
    }
    Write-Host "Signing skipped: set ADVOICE_SIGN_PFX and ADVOICE_SIGN_PASSWORD for a trusted release."
    exit 0
}
if (-not (Test-Path -LiteralPath $certificate -PathType Leaf)) {
    throw "Code-signing certificate was not found: $certificate"
}

$signTool = $env:ADVOICE_SIGNTOOL
if (-not $signTool) {
    $kits = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
    $signTool = Get-ChildItem -LiteralPath $kits -Filter signtool.exe -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match "\\x64\\signtool\.exe$" } |
        Sort-Object FullName -Descending |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $signTool -or -not (Test-Path -LiteralPath $signTool -PathType Leaf)) {
    throw "signtool.exe was not found. Install the Windows SDK or set ADVOICE_SIGNTOOL."
}

foreach ($artifact in $Path) {
    $resolved = (Resolve-Path -LiteralPath $artifact).Path
    $arguments = @("sign", "/fd", "SHA256", "/td", "SHA256", "/tr", "http://timestamp.digicert.com", "/f", $certificate)
    if ($password) { $arguments += @("/p", $password) }
    $arguments += $resolved
    & $signTool @arguments | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Signing failed: $resolved" }
    & $signTool verify /pa /q $resolved | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Signature verification failed: $resolved" }
}
