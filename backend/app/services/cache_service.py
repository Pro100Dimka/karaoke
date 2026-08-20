from __future__ import annotations

import shutil
from pathlib import Path

import config
from app import repositories
from app.services import revision_cache, song_service
from app.services.db_utils import commit
from database import SessionLocal

_INTERMEDIATE_DIRS = ("tmp", "__pycache__", ".ai-cache")


def _dir_size_bytes(path: Path) -> int:
    return 0 if not path.exists() else sum(
        item.stat().st_size for item in path.rglob("*") if item.is_file()
    )


def _human(num_bytes: int) -> str:
    size = float(num_bytes)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} PB"


def cache_size() -> dict:
    breakdown = {
        "karaoke_songs": _dir_size_bytes(config.SONG_OUTPUT_DIR),
        "database": Path(config.DB_PATH).stat().st_size if Path(config.DB_PATH).exists() else 0,
        "cache": _dir_size_bytes(config.CACHE_DIR),
    }
    total = sum(breakdown.values())
    return {"total_bytes": total, "total_human": _human(total), "breakdown": breakdown}


def free_space() -> dict:
    usage = shutil.disk_usage(config.CACHE_DIR)
    return {
        "free_bytes": usage.free,
        "free_human": _human(usage.free),
        "total_bytes": usage.total,
        "total_human": _human(usage.total),
    }


def _remove_intermediates(output_dir: Path) -> tuple[int, list[str]]:
    freed, actions = 0, []
    for name in _INTERMEDIATE_DIRS:
        target = output_dir / name
        if not target.exists():
            continue
        freed += _dir_size_bytes(target)
        shutil.rmtree(target, ignore_errors=True)
        actions.append(f"удалена временная папка {name}/")
    return freed, actions


def clear_temp_files() -> int:
    if not config.SONG_OUTPUT_DIR.exists():
        return 0
    return sum(
        _remove_intermediates(song_dir)[0]
        for song_dir in config.SONG_OUTPUT_DIR.iterdir()
        if song_dir.is_dir()
    )


def recover_optimization_state(_output_dir: Path, *, committed: bool) -> None:
    del committed


def recover_optimization_transactions() -> None:
    return None


def optimize_song_files(song_id: str) -> dict:
    db = SessionLocal()
    try:
        song = repositories.get_song(db, song_id)
        if song is None or not song.output_dir:
            return {
                "song_id": song_id,
                "freed_bytes": 0,
                "freed_human": _human(0),
                "actions": [],
            }
        with song_service.song_content_lock(song_id), song_service.library_write_lock():
            db.refresh(song)
            freed, actions = _remove_intermediates(song_service.resolve_output_dir(song))
            song.optimized = True
            commit(db)
            revision_cache.invalidate(song)
            return {
                "song_id": song_id,
                "freed_bytes": freed,
                "freed_human": _human(freed),
                "actions": actions,
            }
    finally:
        db.close()
