"""Reversible filesystem removal helpers for database-backed resources."""

from __future__ import annotations

import gc
import os
import shutil
import time
import uuid
from collections.abc import Iterable
from pathlib import Path

QuarantineMap = dict[Path, Path]

_WINDOWS_SHARING_ERRORS = {5, 32, 33}


def _replace_with_retry(source: Path, destination: Path, *, attempts: int = 10) -> None:
    delay = 0.05
    for attempt in range(attempts):
        try:
            source.replace(destination)
            return
        except OSError as exc:
            retryable = os.name == "nt" and getattr(exc, "winerror", None) in _WINDOWS_SHARING_ERRORS
            if not retryable or attempt + 1 >= attempts: raise
            gc.collect()
            time.sleep(delay)
            delay = min(delay * 1.7, 0.5)


def existing_unique_paths(paths: Iterable[Path]) -> tuple[Path, ...]:
    """Return existing paths once, preserving the caller's order."""
    return tuple(path for path in dict.fromkeys(paths) if path.exists())


def quarantine_paths(paths: Iterable[Path]) -> QuarantineMap:
    """Move paths aside so they can be restored if a database commit fails."""
    quarantined: QuarantineMap = {}
    try:
        for path in existing_unique_paths(paths):
            temporary = path.with_name(f".{path.name}.delete-{uuid.uuid4().hex}")
            _replace_with_retry(path, temporary)
            quarantined[path] = temporary
    except Exception:
        restore_quarantined_paths(quarantined)
        raise
    return quarantined


def restore_quarantined_paths(quarantined: QuarantineMap) -> None:
    """Restore quarantined paths in reverse order."""
    for original, temporary in reversed(tuple(quarantined.items())):
        if temporary.exists(): _replace_with_retry(temporary, original)


def purge_quarantined_paths(quarantined: QuarantineMap) -> None:
    """Permanently remove quarantined files and directories."""
    for temporary in quarantined.values():
        if temporary.is_dir():
            shutil.rmtree(temporary)
        else:
            temporary.unlink(missing_ok=True)
