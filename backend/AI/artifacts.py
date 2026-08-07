from __future__ import annotations

import os
from pathlib import Path
import secrets


def publish_files_atomically(pairs: list[tuple[Path, Path]]) -> None:
    """Publish related files as one best-effort transaction with rollback.

    All sources must exist before publication. Existing targets are moved to unique
    backups. If any replacement fails, newly published files are removed and every
    previous target is restored.
    """
    if not pairs:
        return
    normalized = [(Path(source), Path(target)) for source, target in pairs]
    missing = [str(source) for source, _ in normalized if not source.is_file()]
    if missing:
        raise FileNotFoundError(f"Missing transaction source(s): {', '.join(missing)}")
    targets = [target.resolve() for _, target in normalized]
    if len(set(targets)) != len(targets):
        raise ValueError("Transaction targets must be unique")

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
            try:
                target.unlink(missing_ok=True)
            except OSError:
                pass
        for target, backup in reversed(backups):
            if backup.exists():
                os.replace(backup, target)
        raise
    else:
        for _, backup in backups:
            try:
                backup.unlink(missing_ok=True)
            except OSError:
                # Publication succeeded; an orphaned backup is safer than reporting
                # a false processing failure after replacing all targets.
                pass
