"""Portable song packages used for direct peer-to-peer library sync."""

from __future__ import annotations

import json
import shutil
import stat
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

from sqlalchemy.orm import Session

import config
import models
from app.services import song_service
from app.services.db_utils import commit_refresh
from app.utils.atomic_files import atomic_write

MAX_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024
MAX_PACKAGE_FILES = 500
MAX_PACKAGE_COMPRESSION_RATIO = 200
_SKIPPED_DIRS = {config.LOGS_DIRNAME, config.RECORDINGS_DIRNAME}


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

    with tempfile.NamedTemporaryFile(
        prefix="karaoke-song-",
        suffix=".karaoke.zip",
        dir=config.DATA_DIR,
        delete=False,
    ) as package:
        package_path = Path(package.name)
    try:
        with zipfile.ZipFile(package_path, "w", zipfile.ZIP_DEFLATED, compresslevel=4) as archive:
            archive.writestr(
                "manifest.json",
                json.dumps(_manifest(song), ensure_ascii=False, indent=2),
            )
            archive.write(source, f"source/{source.name}")
            for path in output_dir.rglob("*"):
                # Never follow library symlinks into unrelated user files.
                if path.is_symlink() or not path.is_file():
                    continue
                relative = path.relative_to(output_dir)
                if any(part in _SKIPPED_DIRS for part in relative.parts):
                    continue
                if path.name.startswith("take-") or path.name == "pipeline.log":
                    continue
                if path.resolve() == source.resolve():
                    continue
                archive.write(
                    path, (PurePosixPath("output") / PurePosixPath(relative.as_posix())).as_posix()
                )
        return package_path
    except Exception:
        package_path.unlink(missing_ok=True)
        raise


def _member_path(member: zipfile.ZipInfo) -> PurePosixPath:
    """Return a validated portable ZIP path."""
    name = member.filename
    if not name or "\x00" in name or "\\" in name or ":" in name:
        raise ValueError("Song package contains an unsafe path")
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError("Song package contains an unsafe path")
    return path


def _safe_members(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    members = archive.infolist()
    if len(members) > MAX_PACKAGE_FILES:
        raise ValueError("Song package contains too many files")
    total_size = sum(member.file_size for member in members)
    if total_size > MAX_PACKAGE_BYTES:
        raise ValueError("Song package is too large")
    normalized: set[PurePosixPath] = set()
    for member in members:
        unix_mode = getattr(member, "external_attr", 0) >> 16
        if stat.S_IFMT(unix_mode) == stat.S_IFLNK:
            raise ValueError("Song package contains a symbolic link")
        if member.flag_bits & 0x1:
            raise ValueError("Encrypted song packages are not supported")
        if (
            not member.is_dir()
            and member.file_size > 1024 * 1024
            and member.file_size > max(1, member.compress_size) * MAX_PACKAGE_COMPRESSION_RATIO
        ):
            raise ValueError("Song package contains a suspiciously compressed file")
        path = _member_path(member)
        if path in normalized:
            raise ValueError("Song package contains duplicate paths")
        normalized.add(path)
    return members


def _read_manifest(archive: zipfile.ZipFile) -> dict[str, object]:
    try:
        manifest = json.loads(archive.read("manifest.json"))
    except (KeyError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError("Song package manifest is invalid") from exc
    if not isinstance(manifest, dict):
        raise ValueError("Song package manifest is invalid")
    return manifest


def _package_identity(manifest: dict[str, object]) -> tuple[str, str]:
    song_id = str(manifest.get("id") or "").strip()
    title = str(manifest.get("title") or "").strip()
    if not song_id or not title:
        raise ValueError("Song package has no song id or title")
    return song_id, title


def _source_member(members: list[zipfile.ZipInfo]) -> zipfile.ZipInfo:
    sources = [
        member
        for member in members
        if _member_path(member).parts[:1] == ("source",) and not member.is_dir()
    ]
    if len(sources) != 1:
        raise ValueError("Song package must contain one source file")
    source = sources[0]
    if Path(_member_path(source).name).suffix.lower() not in config.ALLOWED_AUDIO_EXTENSIONS:
        raise ValueError("Song package source format is not supported")
    return source


def _copy_archive_member(
    archive: zipfile.ZipFile,
    member: zipfile.ZipInfo,
    destination: Path,
) -> None:
    def copy(target) -> None:
        with archive.open(member) as source:
            shutil.copyfileobj(source, target, length=1024 * 1024)

    atomic_write(destination, copy)


def _extract_output(
    archive: zipfile.ZipFile,
    members: list[zipfile.ZipInfo],
    destination: Path,
) -> None:
    for member in members:
        parts = _member_path(member).parts
        if member.is_dir() or not parts or parts[0] != "output":
            continue
        _copy_archive_member(archive, member, destination / Path(*parts[1:]))


def _song_from_manifest(
    manifest: dict[str, object],
    *,
    song_id: str,
    title: str,
    slug: str,
    source_path: Path,
    output_dir: Path,
) -> models.Song:
    return models.Song(
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


def import_package(db: Session, package_path: Path) -> models.Song:
    """Import a peer package atomically while preserving the shared song id."""
    with zipfile.ZipFile(package_path) as archive:
        members = _safe_members(archive)
        manifest = _read_manifest(archive)
        song_id, title = _package_identity(manifest)
        existing = song_service.get_song(db, song_id)
        if existing is not None:
            return existing

        source_member = _source_member(members)
        extension = Path(_member_path(source_member).name).suffix.lower()
        base_slug = song_service.slugify(str(manifest.get("slug") or title), "song")
        with song_service.library_write_lock():
            # Re-check after waiting for another concurrent import/create operation.
            existing = song_service.get_song(db, song_id)
            if existing is not None:
                return existing
            slug = song_service.make_unique_slug(db, base_slug)
            output_dir = config.SONG_OUTPUT_DIR / slug
            temporary_output = Path(tempfile.mkdtemp(prefix="song-import-", dir=config.DATA_DIR))
            source_path = temporary_output / f"source{extension}"
            try:
                _copy_archive_member(archive, source_member, source_path)
                _extract_output(archive, members, temporary_output)
                temporary_output.replace(output_dir)
                source_path = output_dir / source_path.name
                song = _song_from_manifest(
                    manifest,
                    song_id=song_id,
                    title=title,
                    slug=slug,
                    source_path=source_path,
                    output_dir=output_dir,
                )
                db.add(song)
                return commit_refresh(db, song)
            except Exception:
                db.rollback()
                shutil.rmtree(output_dir, ignore_errors=True)
                shutil.rmtree(temporary_output, ignore_errors=True)
                raise
