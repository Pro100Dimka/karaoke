from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
BUILD_SCRIPT = ROOT / "scripts" / "build-installer.ps1"
FUNCTIONS = (
    "Get-StatePath",
    "Get-OutputStatePath",
    "Get-FileSha256",
    "Test-ArchiveIntegrity",
    "Get-OutputManifestJson",
    "Get-State",
    "Set-State",
    "Test-StepNeeded",
)


def _powershell() -> str:
    executable = shutil.which("pwsh") or shutil.which("powershell")
    if os.name != "nt" or not executable or not shutil.which("tar.exe"):
        pytest.skip("Windows PowerShell and tar.exe are required")
    return executable


def _harness(state_dir: Path, body: str) -> str:
    names = ",".join(f"'{name}'" for name in FUNCTIONS)
    script = str(BUILD_SCRIPT).replace("'", "''")
    state = str(state_dir).replace("'", "''")
    return f"""
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile(
    '{script}', [ref]$tokens, [ref]$errors
)
if ($errors.Count) {{ throw ($errors | Out-String) }}
foreach ($name in @({names})) {{
    $definition = $ast.Find({{
        param($node)
        $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
            $node.Name -eq $name
    }}, $true)
    if (-not $definition) {{ throw "Function not found: $name" }}
    Invoke-Expression $definition.Extent.Text
}}
$StateDir = '{state}'
$OutputManifestSchema = 'build-output-manifest-v2-sha256-archive-check'
$script:StepRequiredOutputs = @{{}}
$script:TarExe = (Get-Command tar.exe).Source
{body}
"""


def _run(state_dir: Path, body: str, *, check: bool = True):
    return subprocess.run(
        [_powershell(), "-NoProfile", "-NonInteractive", "-Command", _harness(state_dir, body)],
        check=check,
        capture_output=True,
        text=True,
    )


def test_output_manifest_is_versioned_and_one_byte_change_invalidates_cache(tmp_path):
    artifact = tmp_path / "artifact.bin"
    artifact.write_bytes(b"abc")
    quoted = str(artifact).replace("'", "''")
    _run(tmp_path / "state", f"""
$script:StepRequiredOutputs['fixture'] = @('{quoted}')
Set-State 'fixture' 'input-v1'
if (Test-StepNeeded 'fixture' 'input-v1' @('{quoted}')) {{ exit 11 }}
Get-OutputManifestJson @('{quoted}')
""")
    manifest = json.loads(_run(
        tmp_path / "state", f"Get-OutputManifestJson @('{quoted}')"
    ).stdout.strip())
    assert manifest["schema"] == "build-output-manifest-v2-sha256-archive-check"

    artifact.write_bytes(b"abd")
    changed = _run(
        tmp_path / "state",
        f"if (-not (Test-StepNeeded 'fixture' 'input-v1' @('{quoted}'))) {{ exit 12 }}",
    )
    assert "cached output changed or corrupted" in changed.stdout


def test_corrupt_zip_cannot_be_recorded_as_valid_cached_output(tmp_path):
    archive = tmp_path / "broken.zip"
    archive.write_bytes(b"not-a-zip")
    quoted = str(archive).replace("'", "''")
    result = _run(tmp_path / "state", f"""
$script:StepRequiredOutputs['runtime'] = @('{quoted}')
Set-State 'runtime' 'input-v1'
""", check=False)

    assert result.returncode != 0
    assert "archive integrity check failed" in result.stderr
