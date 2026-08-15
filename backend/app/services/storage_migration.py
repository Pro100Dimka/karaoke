"""One-time migration from the historical backend/Song + full_songs layout."""

from __future__ import annotations

import logging
from contextlib import suppress
from pathlib import Path

import config
import models
from app.services.db_utils import commit
from app.utils.atomic_files import move_path
from database import SessionLocal

logger = logging.getLogger(__name__)


def _existing_source(target: Path) -> Path | None:
    """Find the normalized or retained source after an interrupted legacy move."""
    for pattern in ("song.mp3", "song.wav", "source.*"):
        candidate = next((path for path in target.glob(pattern) if path.is_file()), None)
        if candidate is not None:
            return candidate
    return None


def _legacy_output(song: models.Song) -> Path:
    stored = Path(song.output_dir) if song.output_dir else config.BASE_DIR / "Song" / song.slug
    return stored.resolve()


def migrate_legacy_song_storage() -> None:
    """Move existing libraries into root/karaoke_songs without duplicating audio."""
    db = SessionLocal()
    try:
        songs = db.query(models.Song).all()
        for song in songs:
            previous_output = _legacy_output(song)
            library_root = config.SONG_OUTPUT_DIR.resolve()
            target = (
                previous_output
                if previous_output.is_relative_to(library_root)
                else (library_root / song.slug).resolve()
            )
            previous_source = Path(song.source_path).resolve()

            if previous_output.is_dir() and previous_output != target and not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                move_path(previous_output, target)

            target.mkdir(parents=True, exist_ok=True)
            normalized = target / "song.mp3"
            if normalized.is_file():
                if previous_source.is_file() and previous_source != normalized:
                    previous_source.unlink()
                song.source_path = str(normalized)
            elif previous_source.is_file() and target not in previous_source.parents:
                migrated_source = target / f"source{previous_source.suffix.lower()}"
                if not migrated_source.exists():
                    move_path(previous_source, migrated_source)
                song.source_path = str(migrated_source)
            elif previous_output != target and previous_output in previous_source.parents:
                song.source_path = str(target / previous_source.relative_to(previous_output))

            if not Path(song.source_path).is_file():
                retained_source = _existing_source(target)
                if retained_source is not None:
                    song.source_path = str(retained_source)

            song.output_dir = str(target)
        commit(db)
    except Exception:
        db.rollback()
        logger.exception("Could not migrate the legacy song library")
        raise
    finally:
        db.close()

    for legacy in (config.BASE_DIR / "Song", config.BASE_DIR / "full_songs"):
        with suppress(FileNotFoundError, OSError):
            legacy.rmdir()
