"""Small JSON helpers shared by the standalone AI pipeline."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def load_json(path: str | Path) -> Any:
    """Read UTF-8 JSON from *path*."""
    return json.loads(Path(path).read_text(encoding="utf-8"))


def save_json(value: Any, path: str | Path) -> None:
    """Atomically write UTF-8 JSON without leaving a partial target file."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{target.name}.", suffix=".tmp", dir=target.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(target)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
