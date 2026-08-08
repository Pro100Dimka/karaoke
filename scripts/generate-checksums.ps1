param(
    [Parameter(Mandatory = $true)]
    [string] $InstallerDirectory,

    [Parameter(Mandatory = $true)]
    [string] $OutputFile
)

$ErrorActionPreference = "Stop"

$files = Get-ChildItem -LiteralPath $InstallerDirectory -File |
    Where-Object { $_.Extension -in ".exe", ".bin" } |
    Sort-Object Name

if ($files.Count -eq 0) {
    throw "No installer files were found in '$InstallerDirectory'."
}

$utf8WithoutBom = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($OutputFile, "", $utf8WithoutBom)

foreach ($file in $files) {
    $certutilOutput = @(certutil -hashfile $file.FullName SHA256)
    if ($LASTEXITCODE -ne 0) {
        throw "Could not calculate SHA-256 for '$($file.FullName)'."
    }

    $hash = $certutilOutput |
        Where-Object { $_ -match "^[0-9a-fA-F]{64}$" } |
        Select-Object -First 1

    if (-not $hash) {
        throw "Could not parse SHA-256 for '$($file.FullName)'."
    }

    $line = $hash.Trim().ToLowerInvariant() + "  " + $file.Name + [Environment]::NewLine
    [IO.File]::AppendAllText($OutputFile, $line, $utf8WithoutBom)
    Write-Host "  hashed: $($file.Name)"
}

Write-Host "Created $OutputFile with $($files.Count) checksums."
