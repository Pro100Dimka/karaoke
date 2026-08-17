"""One-time migration from the historical backend/Song + full_songs layout."""

from __future__ import annotations

import logging
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path

import config
import models
from app.services.db_utils import commit
from app.utils.atomic_files import move_path
from database import SessionLocal

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class _Move:
    source: Path
    target: Path

    def rollback(self) -> None:
        if self.target.exists() and not self.source.exists():
            self.source.parent.mkdir(parents=True, exist_ok=True)
            move_path(self.target, self.source)


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


def _historical_roots() -> tuple[Path, Path]:
    return ((config.BASE_DIR / "Song").resolve(), (config.BASE_DIR / "full_songs").resolve())


def _is_historical(path: Path) -> bool:
    resolved = path.resolve()
    return any(resolved == root or resolved.is_relative_to(root) for root in _historical_roots())


def _recorded_move(source: Path, target: Path, moves: list[_Move]) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    move_path(source, target)
    moves.append(_Move(source=source, target=target))


def migrate_legacy_song_storage() -> None:
    """Migrate only the application's historical layout with filesystem compensation.

    User-selected previous library roots are deliberately *not* moved on startup.
    They remain readable through ``SONG_LIBRARY_ROOTS`` until the user explicitly
    chooses a migration flow.  For genuine historical paths, every filesystem
    move is recorded and reversed if the database commit fails.
    """
    db = SessionLocal()
    moves: list[_Move] = []
    deferred_deletes: list[Path] = []
    original_paths: list[tuple[models.Song, str, str | None]] = []
    try:
        songs = db.query(models.Song).all()
        library_root = config.SONG_OUTPUT_DIR.resolve()
        for song in songs:
            previous_output = _legacy_output(song)
            previous_source = Path(song.source_path).resolve()

            # Multi-root libraries are a supported persistent state.  Startup
            # migration is reserved for the old built-in Song/full_songs layout.
            if not (_is_historical(previous_output) or _is_historical(previous_source)):
                continue

            original_paths.append((song, song.source_path, song.output_dir))
            target = (library_root / song.slug).resolve()

            if previous_output.is_dir() and previous_output != target and not target.exists():
                _recorded_move(previous_output, target, moves)

            target.mkdir(parents=True, exist_ok=True)
            normalized = target / "song.mp3"
            if normalized.is_file():
                if previous_source.is_file() and previous_source != normalized:
                    # Never destroy rollback data before the DB commit succeeds.
                    deferred_deletes.append(previous_source)
                song.source_path = str(normalized)
            elif previous_source.is_file() and target not in previous_source.parents:
                migrated_source = target / f"source{previous_source.suffix.lower()}"
                if not migrated_source.exists():
                    _recorded_move(previous_source, migrated_source, moves)
                song.source_path = str(migrated_source)
            elif previous_output != target and previous_output in previous_source.parents:
                song.source_path = str(target / previous_source.relative_to(previous_output))

            if not Path(song.source_path).is_file():
                if (retained_source := _existing_source(target)) is not None:
                    song.source_path = str(retained_source)

            song.output_dir = str(target)

        commit(db)
    except Exception:
        db.rollback()
        for song, source_path, output_dir in original_paths:
            song.source_path = source_path
            song.output_dir = output_dir
        rollback_errors: list[Exception] = []
        for operation in reversed(moves):
            try:
                operation.rollback()
            except Exception as exc:  # pragma: no cover - catastrophic recovery path
                rollback_errors.append(exc)
                logger.exception("Could not compensate storage migration move %s -> %s", operation.target, operation.source)
        logger.exception("Could not migrate the legacy song library")
        if rollback_errors:
            raise RuntimeError("Legacy migration failed and filesystem rollback was incomplete") from rollback_errors[0]
        raise
    finally:
        db.close()

    for path in deferred_deletes:
        with suppress(FileNotFoundError, OSError):
            path.unlink()
    for legacy in _historical_roots():
        with suppress(FileNotFoundError, OSError):
            legacy.rmdir()
