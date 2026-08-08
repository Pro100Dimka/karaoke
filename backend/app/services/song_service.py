"""Управление песнями: добавление, чтение, изменение, удаление."""

import re
import threading
import unicodedata
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

import config
import models
import schemas
from app import repositories
from app.services.db_utils import commit_refresh
from app.services.resource_deletion import delete_with_files
from app.utils.atomic_files import atomic_write_bytes

_library_write_lock = threading.RLock()


@contextmanager
def library_write_lock():
    """Serialize library mutations that allocate filesystem names."""
    with _library_write_lock:
        yield


def _slug_has_files(slug: str) -> bool:
    if (config.SONG_OUTPUT_DIR / slug).exists():
        return True
    return any(
        (config.FULL_SONGS_DIR / f"{slug}{extension}").exists()
        for extension in config.ALLOWED_AUDIO_EXTENSIONS
    )


def _slug_exists(db: Session, slug: str) -> bool:
    return db.query(models.Song.id).filter(models.Song.slug == slug).first() is not None


def _ensure_path_within(path: Path, root: Path) -> Path:
    """Resolve a persisted path and reject anything outside its owned folder."""
    resolved_path = path.resolve()
    resolved_root = root.resolve()
    if resolved_path == resolved_root or resolved_root in resolved_path.parents:
        return resolved_path
    raise ValueError("Song file path is outside the application library")


def resolve_source_path(song: models.Song) -> Path:
    """Return the validated path to a song's original audio file."""
    return _ensure_path_within(Path(song.source_path), config.FULL_SONGS_DIR)


def resolve_output_dir(song: models.Song) -> Path:
    """Return the validated directory that belongs to a song's generated data."""
    path = Path(song.output_dir) if song.output_dir else config.SONG_OUTPUT_DIR / song.slug
    return _ensure_path_within(path, config.SONG_OUTPUT_DIR)


def slugify(title: str, fallback: str) -> str:
    """Человекочитаемое, но filesystem-safe имя папки под Song/<slug>.
    Не гарантирует уникальность сама по себе — уникальность обеспечивает
    вызывающий код (добавлением суффикса при коллизии)."""
    normalized = unicodedata.normalize("NFKD", title)
    ascii_ish = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_ish).strip("-").lower()
    return slug or fallback


def make_unique_slug(db: Session, base_slug: str) -> str:
    """Return a slug unused by both SQLite and application-owned folders."""
    slug = base_slug
    suffix = 2
    while _slug_exists(db, slug) or _slug_has_files(slug):
        slug = f"{base_slug}-{suffix}"
        suffix += 1
    return slug


def _song_input(title: str, original_filename: str) -> tuple[str, str, str]:
    """Normalize upload metadata and validate the source extension."""
    safe_original_name = Path(original_filename).name.strip() or "song"
    extension = Path(safe_original_name).suffix.lower()
    if extension not in config.ALLOWED_AUDIO_EXTENSIONS:
        raise ValueError(
            f"Неподдерживаемый формат файла: {extension or '(нет расширения)'}. "
            f"Разрешено: {', '.join(sorted(config.ALLOWED_AUDIO_EXTENSIONS))}"
        )
    clean_title = title.strip() or Path(safe_original_name).stem
    return clean_title, safe_original_name, extension


def _persist_song(
    db: Session,
    *,
    title: str,
    original_filename: str,
    extension: str,
    write_source,
) -> models.Song:
    """Allocate a library name, store its source, and commit the database row."""
    base_slug = slugify(title, fallback="song")
    with library_write_lock():
        slug = make_unique_slug(db, base_slug)
        destination = config.FULL_SONGS_DIR / f"{slug}{extension}"
        write_source(destination)
        song = models.Song(
            title=title,
            original_filename=original_filename,
            source_path=str(destination),
            slug=slug,
            status=models.SongStatus.PENDING,
        )
        db.add(song)
        try:
            return commit_refresh(db, song)
        except Exception:
            destination.unlink(missing_ok=True)
            raise


def create_song(db: Session, title: str, original_filename: str, file_bytes: bytes) -> models.Song:
    """Store an in-memory source. Retained for internal callers and small tests."""
    clean_title, safe_name, extension = _song_input(title, original_filename)
    if not file_bytes:
        raise ValueError("Audio file is empty")
    return _persist_song(
        db,
        title=clean_title,
        original_filename=safe_name,
        extension=extension,
        write_source=lambda destination: atomic_write_bytes(destination, file_bytes),
    )


def create_song_from_path(
    db: Session,
    title: str,
    original_filename: str,
    temporary_source: Path,
) -> models.Song:
    """Move a streamed upload into the song library without loading it into RAM."""
    clean_title, safe_name, extension = _song_input(title, original_filename)
    if not temporary_source.is_file() or temporary_source.stat().st_size == 0:
        raise ValueError("Audio file is empty")

    def move_source(destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary_source.replace(destination)

    return _persist_song(
        db,
        title=clean_title,
        original_filename=safe_name,
        extension=extension,
        write_source=move_source,
    )


def list_songs(db: Session) -> list[models.Song]:
    return list(db.scalars(select(models.Song).order_by(models.Song.created_at.desc())))


def get_song(db: Session, song_id: str) -> models.Song | None:
    """Backward-compatible service facade around the shared repository."""
    return repositories.get_song(db, song_id)


def update_song(db: Session, song: models.Song, patch: schemas.SongUpdate) -> models.Song:
    """Apply a partial update and restore the in-memory object if commit fails."""
    changes = patch.model_dump(exclude_unset=True)
    note_min = changes.get("note_range_min", getattr(song, "note_range_min", None))
    note_max = changes.get("note_range_max", getattr(song, "note_range_max", None))
    if note_min is not None and note_max is not None and note_min > note_max:
        raise ValueError("note_range_min must not exceed note_range_max")
    previous = {field: getattr(song, field) for field in changes}
    for field, value in changes.items():
        setattr(song, field, value)
    try:
        return commit_refresh(db, song)
    except Exception:
        for field, value in previous.items():
            setattr(song, field, value)
        raise


def delete_song(db: Session, song: models.Song) -> None:
    """Delete a song without losing files when the database commit fails."""
    delete_with_files(db, song, (resolve_output_dir(song), resolve_source_path(song)))
