import os
from contextlib import suppress
from pathlib import Path


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
