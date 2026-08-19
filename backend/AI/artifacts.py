from __future__ import annotations

import os
import secrets
from contextlib import suppress
from pathlib import Path


def publish_files_atomically(pairs: list[tuple[Path, Path]]) -> None:
    if not pairs: return
    normalized = [(Path(source), Path(target)) for source, target in pairs]
    if missing := [str(source) for source, _ in normalized if not source.is_file()]: raise FileNotFoundError(f"Missing transaction source(s): {', '.join(missing)}")
    targets = [target.resolve() for _, target in normalized]
    if len(set(targets)) != len(targets): raise ValueError("Transaction targets must be unique")

    token = secrets.token_hex(8)
    backups: list[tuple[Path, Path]] = []
    published: list[Path] = []
    try:
        for _, target in normalized:
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                backup = target.with_name(f".{target.name}.{token}.bak")
                os.replace(target, backup)
                backups.append((target, backup))
        for source, target in normalized:
            os.replace(source, target)
            published.append(target)
    except BaseException:
        for target in reversed(published):
            with suppress(OSError): target.unlink(missing_ok=True)
        for target, backup in reversed(backups):
            if backup.exists(): os.replace(backup, target)
        raise
    else:
        for _, backup in backups:
            with suppress(OSError): backup.unlink(missing_ok=True)
