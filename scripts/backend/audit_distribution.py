"""Reject runtime and build artifacts that must never ship with source updates."""

from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "backend"
FORBIDDEN_DIRS = {
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "htmlcov",
}
FORBIDDEN_SUFFIXES = {".pyc", ".pyo", ".db", ".db-wal", ".db-shm"}
FORBIDDEN_FILES = {".coverage"}
IGNORED_ROOTS = {"engines", ".venv", "venv"}


def violations() -> list[Path]:
    project_root = ROOT.parent
    tracked = subprocess.run(
        ["git", "ls-files", "--", "backend"],
        cwd=project_root,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    ).stdout.splitlines()
    found: list[Path] = []
    for name in tracked:
        relative = Path(name).relative_to("backend")
        if relative.parts and relative.parts[0] in IGNORED_ROOTS:
            continue
        if (
            FORBIDDEN_DIRS.intersection(relative.parts)
            or relative.name in FORBIDDEN_FILES
            or any(relative.name.endswith(suffix) for suffix in FORBIDDEN_SUFFIXES)
        ):
            found.append(relative)
    return sorted(set(found))


def main() -> int:
    found = violations()
    if found:
        print("Distribution audit failed; remove generated/runtime artifacts:")
        print("\n".join(f"- {path}" for path in found))
        return 1
    print("Distribution audit passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
