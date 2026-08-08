"""Atomic filesystem writes for application-owned files."""

from __future__ import annotations

import contextlib
import os
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import BinaryIO


def _temporary_path(path: Path) -> tuple[int, Path]:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )
    return descriptor, Path(name)


def _sync_directory(path: Path) -> None:
    """Best-effort directory sync after an atomic replace (not available on Windows)."""
    if os.name == "nt":
        return
    with contextlib.suppress(OSError):
        descriptor = os.open(path, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def atomic_write(path: Path, writer: Callable[[BinaryIO], None]) -> None:
    """Write *path* through a unique sibling temp file and atomically replace it."""
    descriptor, temporary = _temporary_path(path)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            writer(stream)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
        _sync_directory(path.parent)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def atomic_write_bytes(path: Path, payload: bytes) -> None:
    """Atomically write a bytes payload."""

    def write_payload(stream: BinaryIO) -> None:
        stream.write(payload)

    atomic_write(path, write_payload)
