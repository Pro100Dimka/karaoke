"""Управление песнями: добавление, чтение, изменение, удаление."""

import re
import shutil
import unicodedata
from pathlib import Path

from sqlalchemy.orm import Session

import config
import models
import schemas


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
    slug = base_slug
    i = 2
    while db.query(models.Song).filter(models.Song.slug == slug).first() is not None:
        slug = f"{base_slug}-{i}"
        i += 1
    return slug


def create_song(db: Session, title: str, original_filename: str, file_bytes: bytes) -> models.Song:
    """Сохраняет загруженный файл в full_songs/ и создаёт запись в БД со статусом PENDING."""
    ext = Path(original_filename).suffix.lower()
    if ext not in config.ALLOWED_AUDIO_EXTENSIONS:
        raise ValueError(
            f"Неподдерживаемый формат файла: {ext or '(нет расширения)'}. "
            f"Разрешено: {', '.join(sorted(config.ALLOWED_AUDIO_EXTENSIONS))}"
        )

    base_slug = slugify(title or Path(original_filename).stem, fallback="song")
    slug = make_unique_slug(db, base_slug)

    dest_path = config.FULL_SONGS_DIR / f"{slug}{ext}"
    dest_path.write_bytes(file_bytes)

    song = models.Song(
        title=title or Path(original_filename).stem,
        original_filename=original_filename,
        source_path=str(dest_path),
        slug=slug,
        status=models.SongStatus.PENDING,
    )
    db.add(song)
    try:
        db.commit()
        db.refresh(song)
    except Exception:
        # Do not leave an unreferenced original file when the database write
        # fails (for example, after an interrupted disk/database operation).
        db.rollback()
        dest_path.unlink(missing_ok=True)
        raise
    return song


def list_songs(db: Session) -> list[models.Song]:
    return db.query(models.Song).order_by(models.Song.created_at.desc()).all()


def get_song(db: Session, song_id: str) -> models.Song | None:
    return db.query(models.Song).filter(models.Song.id == song_id).first()


def update_song(db: Session, song: models.Song, patch: schemas.SongUpdate) -> models.Song:
    data = patch.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(song, field, value)
    db.commit()
    db.refresh(song)
    return song


def delete_song(db: Session, song: models.Song) -> None:
    """Удаляет запись из БД и все файлы на диске (оригинал в full_songs/,
    папку результатов Song/<slug>/)."""
    source = resolve_source_path(song)
    output_dir = resolve_output_dir(song)
    # Delete generated data first. If a file is locked, retain the database
    # record and original source instead of reporting a misleading success.
    if output_dir.exists():
        shutil.rmtree(output_dir)
    if source.exists():
        source.unlink()

    db.delete(song)
    db.commit()
