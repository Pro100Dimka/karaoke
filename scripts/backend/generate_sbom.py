"""Dependency/license manifest for the backend Python environment.

Enumerates every installed distribution via the standard library (no extra
dependency needed) and writes name/version/license to
generated/sbom/backend.json, so a license or supply-chain question about any
runtime or dev dependency can be answered from one file instead of manually
cross-referencing requirements*.txt against each package's own metadata.
"""

from __future__ import annotations

import json
import sys
from importlib import metadata
from pathlib import Path

OUTPUT_PATH = Path(__file__).resolve().parents[2] / "generated" / "sbom" / "backend.json"


def _license(distribution: metadata.Distribution) -> str:
    # Modern packages (PEP 639) declare an SPDX expression via
    # License-Expression; older ones use the free-text License field or a
    # "License :: ..." trove classifier. Check all three before giving up.
    expression = distribution.metadata.get("License-Expression")
    if expression and expression.strip():
        return expression.strip()
    declared = distribution.metadata.get("License")
    if declared and declared.strip() and declared.strip().upper() != "UNKNOWN":
        return declared.strip()
    for classifier in distribution.metadata.get_all("Classifier", []):
        if classifier.startswith("License :: "):
            return classifier.removeprefix("License :: ").strip()
    for relative in distribution.files or ():
        if "license" not in str(relative).lower():
            continue
        try:
            license_text = distribution.locate_file(relative).read_text(
                encoding="utf-8", errors="ignore"
            )[:4000]
        except OSError:
            continue
        if "Apache License, Version 2.0" in license_text:
            return "Apache-2.0"
        if "MIT License" in license_text:
            return "MIT"
        if "Redistribution and use in source and binary forms" in license_text:
            return "BSD"
    return "UNKNOWN"


def collect_packages() -> list[dict[str, str]]:
    packages = [
        {
            "name": distribution.metadata["Name"],
            "version": distribution.version,
            "license": _license(distribution),
        }
        for distribution in metadata.distributions()
        if distribution.metadata.get("Name")
    ]
    packages.sort(key=lambda package: package["name"].lower())
    return packages


def main() -> int:
    packages = collect_packages()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps({"packageCount": len(packages), "packages": packages}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    unknown = [package["name"] for package in packages if package["license"] == "UNKNOWN"]
    print(f"Wrote {len(packages)} packages to {OUTPUT_PATH}")
    if unknown:
        print(f"{len(unknown)} package(s) have no declared license: {', '.join(unknown)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
