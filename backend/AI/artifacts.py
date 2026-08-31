import os
from contextlib import suppress
from pathlib import Path


def recover_orphaned_backups(root: str | Path) -> list[Path]:
    """Finish or clean interrupted atomic publishes below *root*.

    A backup is restored only when its destination is absent. If both files
    exist, the publish completed and the stale backup is safely discarded.
    """
    root = Path(root)
    if not root.is_dir():
        return []
    restored = []
    for backup in root.rglob("*.bak"):
        target = backup.with_suffix("")
        if target.exists():
            backup.unlink(missing_ok=True)
            continue
        os.replace(backup, target)
        restored.append(target)
    return restored


def publish_files_atomically(pairs: list[tuple[Path, Path]]) -> None:
    backups = []
    published = []
    try:
        for source, target in pairs:
            source, target = Path(source), Path(target)
            if not source.is_file():
                raise FileNotFoundError(source)
            target.parent.mkdir(parents=True, exist_ok=True)
            backup = target.with_suffix(target.suffix + ".bak")
            if target.exists():
                os.replace(target, backup)
                backups.append((target, backup))
            os.replace(source, target)
            published.append(target)
    except BaseException:
        for target in reversed(published):
            target.unlink(missing_ok=True)
        for target, backup in reversed(backups):
            with suppress(OSError):
                os.replace(backup, target)
        raise
    for _, backup in backups:
        backup.unlink(missing_ok=True)
