"""Reversible filesystem removal helpers for database-backed resources."""

from __future__ import annotations

import shutil
import uuid
from collections.abc import Iterable
from pathlib import Path

QuarantineMap = dict[Path, Path]


def existing_unique_paths(paths: Iterable[Path]) -> tuple[Path, ...]:
    """Return existing paths once, preserving the caller's order."""
    return tuple(path for path in dict.fromkeys(paths) if path.exists())


def quarantine_paths(paths: Iterable[Path]) -> QuarantineMap:
    """Move paths aside so they can be restored if a database commit fails."""
    quarantined: QuarantineMap = {}
    try:
        for path in existing_unique_paths(paths):
            temporary = path.with_name(f".{path.name}.delete-{uuid.uuid4().hex}")
            path.replace(temporary)
            quarantined[path] = temporary
    except Exception:
        restore_quarantined_paths(quarantined)
        raise
    return quarantined


def restore_quarantined_paths(quarantined: QuarantineMap) -> None:
    """Restore quarantined paths in reverse order."""
    for original, temporary in reversed(tuple(quarantined.items())):
        if temporary.exists():
            temporary.replace(original)


def purge_quarantined_paths(quarantined: QuarantineMap) -> None:
    """Permanently remove quarantined files and directories."""
    for temporary in quarantined.values():
        if temporary.is_dir():
            shutil.rmtree(temporary)
        else:
            temporary.unlink(missing_ok=True)
