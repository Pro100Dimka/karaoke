"""Small, consistent helpers for UTF-8 JSON files owned by the application."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, BinaryIO, TypeVar

from app.utils.atomic_files import atomic_write

T = TypeVar("T")


def read_json(path: Path, default: T | None = None) -> Any | T | None:
    """Return parsed JSON or *default* when the file does not exist."""
    if not path.is_file(): return default
    with path.open(encoding="utf-8") as stream: return json.load(stream)


def write_json(path: Path, payload: Any, *, indent: int = 2) -> None:
    """Atomically write UTF-8 JSON so interrupted writes cannot corrupt state."""

    encoded = (json.dumps(payload, ensure_ascii=False, indent=indent) + "\n").encode("utf-8")

    def write_payload(stream: BinaryIO) -> None: stream.write(encoded)

    atomic_write(path, write_payload)
