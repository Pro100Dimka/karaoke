from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from ..models import to_compact_dict


def write_bytes_atomic(path: str | Path, data: bytes) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)


def write_text_atomic(path: str | Path, text: str) -> None:
    write_bytes_atomic(path, text.encode("utf-8"))


def write_json_atomic(path: str | Path, data: Any, *, compact: bool = False) -> None:
    payload = to_compact_dict(data) if compact else data
    write_text_atomic(path, json.dumps(payload, ensure_ascii=False, indent=None if compact else 2))


def read_json(path: str | Path, default: Any = None) -> Any:
    source = Path(path)
    try:
        text = source.read_text(encoding="utf-8")
    except FileNotFoundError:
        return default
    except OSError:
        raise
    try:
        return json.loads(text)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError(f"Invalid JSON file: {source}") from exc
