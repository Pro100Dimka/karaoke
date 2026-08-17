"""Shared chunked SHA-256 hashing for files and file-like streams."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import IO

_CHUNK_SIZE = 1024 * 1024


def sha256_stream(stream: IO[bytes]) -> str:
    """Hash an already-open binary stream (e.g. a zip member) without loading it fully."""
    digest = hashlib.sha256()
    while chunk := stream.read(_CHUNK_SIZE):
        digest.update(chunk)
    return digest.hexdigest()


def sha256_file(path: Path) -> str:
    """Hash a file on disk without loading it fully into memory."""
    with path.open("rb") as stream:
        return sha256_stream(stream)
