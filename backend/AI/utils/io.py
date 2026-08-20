from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def write_bytes_atomic(path: str | Path, data: bytes) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f"{target.name}.", suffix=".tmp", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)


def write_text_atomic(path: str | Path, text: str) -> None: write_bytes_atomic(path, text.encode('utf-8'))


def write_json_atomic(path: str | Path, data: Any, *, compact: bool = False) -> None:
    payload = json.dumps(
        data,
        ensure_ascii=False,
        indent=None if compact else 2,
        separators=(",", ":") if compact else None,
        sort_keys=True,
        allow_nan=False,
    )
    write_text_atomic(path, payload + "\n")


def read_json(path: str | Path, default: Any = None) -> Any:
    try:
        with Path(path).open("r", encoding="utf-8") as stream: return json.load(stream)
    except (FileNotFoundError, json.JSONDecodeError, OSError, UnicodeError):
        return default
