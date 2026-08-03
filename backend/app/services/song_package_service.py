"""Portable song packages used for direct peer-to-peer library sync."""

from __future__ import annotations

import json
import shutil
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

from sqlalchemy.orm import Session

import config
import models
from app.services import song_service

MAX_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024
MAX_PACKAGE_FILES = 500
_SKIPPED_DIRS = {config.LOGS_DIRNAME, config.RECORDINGS_DIRNAME, "separated"}


def _manifest(song: models.Song) -> dict[str, object]:
    fields = (
        "id",
        "title",
        "artist",
        "genre",
        "original_filename",
        "slug",
        "key_override",
        "tempo_override",
        "note_range_min",
        "note_range_max",
        "difficulty_override",
        "video_url",
        "show_lyrics",
        "show_notes",
        "optimized",
    )
    return {field: getattr(song, field) for field in fields}


def build_package(song: models.Song) -> Path:
    """Create a temporary ZIP containing the source and usable processed data."""
    source = song_service.resolve_source_path(song)
    output_dir = song_service.resolve_output_dir(song)
    if not source.is_file() or not output_dir.is_dir():
        raise ValueError("Song files are incomplete")

    package = tempfile.NamedTemporaryFile(
        prefix="karaoke-song-",
        suffix=".karaoke.zip",
        dir=config.DATA_DIR,
        delete=False,
    )
    package_path = Path(package.name)
    package.close()
    try:
        with zipfile.ZipFile(package_path, "w", zipfile.ZIP_DEFLATED, compresslevel=4) as archive:
            archive.writestr(
                "manifest.json",
                json.dumps(_manifest(song), ensure_ascii=False, indent=2),
            )
            archive.write(source, f"source/{source.name}")
            for path in output_dir.rglob("*"):
                if not path.is_file():
                    continue
                relative = path.relative_to(output_dir)
                if any(part in _SKIPPED_DIRS for part in relative.parts):
                    continue
                if path.name.startswith("take-") or path.name == "pipeline.log":
                    continue
                archive.write(path, (PurePosixPath("output") / PurePosixPath(relative.as_posix())).as_posix())
        return package_path
    except Exception:
        package_path.unlink(missing_ok=True)
        raise


def _safe_members(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    members = archive.infolist()
    if len(members) > MAX_PACKAGE_FILES:
        raise ValueError("Song package contains too many files")
    total_size = sum(member.file_size for member in members)
    if total_size > MAX_PACKAGE_BYTES:
        raise ValueError("Song package is too large")
    for member in members:
        path = PurePosixPath(member.filename)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError("Song package contains an unsafe path")
    return members


def import_package(db: Session, package_path: Path) -> models.Song:
    """Import a peer package atomically while preserving the shared song id."""
    with zipfile.ZipFile(package_path) as archive:
        members = _safe_members(archive)
        try:
            manifest = json.loads(archive.read("manifest.json"))
        except (KeyError, json.JSONDecodeError) as exc:
            raise ValueError("Song package manifest is invalid") from exc
        song_id = str(manifest.get("id") or "").strip()
        title = str(manifest.get("title") or "").strip()
        if not song_id or not title:
            raise ValueError("Song package has no song id or title")
        existing = song_service.get_song(db, song_id)
        if existing is not None:
            return existing

        source_members = [m for m in members if PurePosixPath(m.filename).parts[:1] == ("source",) and not m.is_dir()]
        if len(source_members) != 1:
            raise ValueError("Song package must contain one source file")
        source_member = source_members[0]
        extension = Path(source_member.filename).suffix.lower()
        if extension not in config.ALLOWED_AUDIO_EXTENSIONS:
            raise ValueError("Song package source format is not supported")

        base_slug = song_service.slugify(str(manifest.get("slug") or title), "song")
        slug = song_service.make_unique_slug(db, base_slug)
        source_path = config.FULL_SONGS_DIR / f"{slug}{extension}"
        output_dir = config.SONG_OUTPUT_DIR / slug
        temporary_output = Path(tempfile.mkdtemp(prefix="song-import-", dir=config.DATA_DIR))
        try:
            with archive.open(source_member) as source_file, source_path.open("wb") as target:
                shutil.copyfileobj(source_file, target, length=1024 * 1024)
            for member in members:
                parts = PurePosixPath(member.filename).parts
                if member.is_dir() or not parts or parts[0] != "output":
                    continue
                relative = Path(*parts[1:])
                destination = temporary_output / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member) as source_file, destination.open("wb") as target:
                    shutil.copyfileobj(source_file, target, length=1024 * 1024)
            temporary_output.replace(output_dir)

            song = models.Song(
                id=song_id,
                title=title,
                artist=manifest.get("artist"),
                genre=manifest.get("genre"),
                original_filename=str(manifest.get("original_filename") or source_path.name),
                source_path=str(source_path),
                slug=slug,
                output_dir=str(output_dir),
                status=models.SongStatus.DONE,
                progress_step="imported",
                progress_percent=100.0,
                key_override=manifest.get("key_override"),
                tempo_override=manifest.get("tempo_override"),
                note_range_min=manifest.get("note_range_min"),
                note_range_max=manifest.get("note_range_max"),
                difficulty_override=manifest.get("difficulty_override"),
                video_url=manifest.get("video_url"),
                show_lyrics=bool(manifest.get("show_lyrics", True)),
                show_notes=bool(manifest.get("show_notes", True)),
                optimized=bool(manifest.get("optimized", True)),
            )
            db.add(song)
            db.commit()
            db.refresh(song)
            return song
        except Exception:
            db.rollback()
            source_path.unlink(missing_ok=True)
            shutil.rmtree(output_dir, ignore_errors=True)
            shutil.rmtree(temporary_output, ignore_errors=True)
            raise
