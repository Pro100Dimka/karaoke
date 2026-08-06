"""Reject runtime and build artifacts that must never ship with source updates."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_DIRS = {"__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", "htmlcov"}
FORBIDDEN_SUFFIXES = {".pyc", ".pyo", ".db", ".db-wal", ".db-shm"}
FORBIDDEN_FILES = {".coverage"}
IGNORED_ROOTS = {"engines", "Song", "full_songs", ".venv", "venv"}


def violations() -> list[Path]:
    found: list[Path] = []
    for path in ROOT.rglob("*"):
        relative = path.relative_to(ROOT)
        if relative.parts and relative.parts[0] in IGNORED_ROOTS:
            continue
        if path.is_dir() and path.name in FORBIDDEN_DIRS:
            found.append(relative)
            continue
        if not path.is_file():
            continue
        if path.name in FORBIDDEN_FILES or any(path.name.endswith(suffix) for suffix in FORBIDDEN_SUFFIXES):
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
