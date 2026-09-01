from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
BUILD_SCRIPT = ROOT / "scripts" / "build-installer.ps1"


@pytest.mark.skipif(os.name != "nt", reason="Visual Studio discovery is Windows-only")
def test_installer_discovers_real_visual_studio_with_required_components():
    powershell = shutil.which("pwsh") or shutil.which("powershell")
    program_files = os.environ.get("PROGRAMFILES(X86)")
    vswhere = (
        Path(program_files) / "Microsoft Visual Studio" / "Installer" / "vswhere.exe"
        if program_files
        else None
    )
    if not powershell or not vswhere or not vswhere.is_file():
        pytest.skip("PowerShell or vswhere is not installed")

    expected = subprocess.run(
        [
            str(vswhere),
            "-latest",
            "-products",
            "*",
            "-requires",
            "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
            "-requires",
            "Microsoft.VisualStudio.Component.VC.CMake.Project",
            "-property",
            "installationPath",
        ],
        check=False,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if not expected:
        pytest.skip("No compatible Visual Studio installation is present")

    command = f"""
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile(
    '{str(BUILD_SCRIPT).replace("'", "''")}', [ref]$tokens, [ref]$errors
)
if ($errors.Count) {{ throw ($errors | Out-String) }}
$definition = $ast.Find({{
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
        $node.Name -eq 'Find-VisualStudioInstallation'
}}, $true)
Invoke-Expression $definition.Extent.Text
Find-VisualStudioInstallation
"""
    actual = subprocess.run(
        [powershell, "-NoProfile", "-NonInteractive", "-Command", command],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()

    assert Path(actual).resolve() == Path(expected.splitlines()[0]).resolve()
