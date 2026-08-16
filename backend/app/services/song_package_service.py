"""Portable song packages used for direct peer-to-peer library sync."""

from __future__ import annotations

import hashlib
import json
import shutil
import stat
import subprocess
import tempfile
import unicodedata
import wave
import zipfile
from uuid import uuid4
from pathlib import Path, PurePosixPath

from sqlalchemy.orm import Session


import config
import models
from app.services import revision_cache, song_artifacts, song_service
from app.services.db_utils import commit_refresh
from database import SessionLocal
from app.utils.atomic_files import atomic_write
from app.utils.json_files import read_json, write_json

MAX_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024
MAX_PACKAGE_FILES = 500
MAX_PACKAGE_COMPRESSION_RATIO = 200
MAX_MANIFEST_BYTES = 256 * 1024
PACKAGE_SCHEMA_VERSION = 5
REQUIRED_OUTPUT_KEYS = {"instrumental", "music", "lyricsSync", "reference", "songMap"}
REQUIRED_OUTPUT_PATHS = {"music.json", "lyricsSync.json", "reference.json", "songMap.json", "manifest.json"}
REVISION_ARTIFACTS = ("songMap.json", "reference.json", "lyricsSync.json", "music.json")
REVISION_RUNTIME_FIELDS = (
    "key_override", "tempo_override", "note_range_min", "note_range_max",
    "difficulty_override", "video_url", "show_lyrics", "show_notes", "optimized",
)
REVISION_ENTITY_FIELDS = ("title", "artist", "genre", "original_filename")
REVISION_SCHEMA_VERSION = 3
_WINDOWS_RESERVED_NAMES = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
_SKIPPED_DIRS = {config.LOGS_DIRNAME, config.RECORDINGS_DIRNAME}
_IMPORT_JOURNAL_PREFIX = ".room-import-journal-"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _processing_manifest(root: Path) -> dict[str, object]:
    try:
        payload = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError("Song processing manifest is invalid") from exc
    if not isinstance(payload, dict):
        raise ValueError("Song processing manifest is invalid")
    return payload


def _processing_build_identity(root: Path) -> str:
    payload = _processing_manifest(root)
    build = payload.get("build") or payload.get("version")
    if not isinstance(build, str) or not build.strip():
        raise ValueError("Song processing build identifier is invalid")
    return build.strip()


def _safe_output_relative(value: object, *, key: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Song processing manifest has no {key} output")
    if any(token in value for token in ("\\", ":", "\x00")):
        raise ValueError(f"Song processing manifest has unsafe {key} output")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError(f"Song processing manifest has unsafe {key} output")
    return path.as_posix()


def _instrumental_relative(root: Path) -> str:
    path = song_artifacts.resolve_manifest_output(root, "instrumental")
    if path is None:
        raise ValueError("Song processing manifest has no usable instrumental output")
    if path.suffix.lower() not in config.ALLOWED_AUDIO_EXTENSIONS:
        raise ValueError("Song instrumental format is not supported")
    return path.relative_to(root.resolve()).as_posix()


def _revision_artifact_paths(root: Path) -> tuple[str, ...]:
    return (*REVISION_ARTIFACTS, _instrumental_relative(root))


def _canonical_runtime_state(values: dict[str, object], mode: str) -> dict[str, object]:
    state = {field: values.get(field) for field in REVISION_RUNTIME_FIELDS}
    state["show_lyrics"] = True if state.get("show_lyrics") is None else bool(state["show_lyrics"])
    state["show_notes"] = True if state.get("show_notes") is None else bool(state["show_notes"])
    state["optimized"] = True if state.get("optimized") is None else bool(state["optimized"])
    if mode == "instrumental":
        state["show_lyrics"] = False
        state["show_notes"] = False
    elif mode == "lyrics":
        state["show_notes"] = False
    return state


def _runtime_revision_state(song: models.Song, *, mode: str | None = None) -> dict[str, object]:
    output = song_service.resolve_output_dir(song)
    resolved_mode = mode or _song_mode_from_files(output)
    values = {field: getattr(song, field, None) for field in REVISION_RUNTIME_FIELDS}
    return _canonical_runtime_state(values, resolved_mode)


def _canonical_entity_state(values: dict[str, object], *, source_name: str) -> dict[str, object]:
    title = str(values.get("title") or "").strip()
    return {
        "title": title,
        "artist": values.get("artist"),
        "genre": values.get("genre"),
        "original_filename": str(values.get("original_filename") or source_name),
    }


def _entity_revision_state(song: models.Song) -> dict[str, object]:
    source = song_service.resolve_source_path(song)
    values = {field: getattr(song, field, None) for field in REVISION_ENTITY_FIELDS}
    return _canonical_entity_state(values, source_name=source.name)


def _revision_payload(song: models.Song) -> dict[str, object]:
    root = song_service.resolve_output_dir(song)
    source = song_service.resolve_source_path(song)
    artifacts: dict[str, str] = {}
    for relative in _revision_artifact_paths(root):
        path = root / relative
        if not path.is_file():
            raise ValueError(f"Song artifact is missing: {relative}")
        artifacts[relative] = _sha256_file(path)
    if not source.is_file():
        raise ValueError("Song source is missing")
    mode = _song_mode_from_files(root)
    return {
        "revision_schema": REVISION_SCHEMA_VERSION,
        "artifacts": artifacts,
        "source_sha256": _sha256_file(source),
        "runtime": _runtime_revision_state(song, mode=mode),
        "entity": _entity_revision_state(song),
        "processing_build": _processing_build_identity(root),
    }


def _hash_revision_payload(payload: dict[str, object]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def compute_content_revision(song: models.Song) -> str:
    """Compute canonical shared karaoke runtime identity from semantic state."""
    return _hash_revision_payload(_revision_payload(song))


def _revision_signature(song: models.Song) -> tuple[object, ...]:
    root = song_service.resolve_output_dir(song)
    source = song_service.resolve_source_path(song)
    paths = [root / relative for relative in _revision_artifact_paths(root)] + [root / "manifest.json", source]
    stats: list[object] = [str(root)]
    for path in paths:
        if not path.is_file():
            raise ValueError(f"Song artifact is missing: {path.name}")
        info = path.stat()
        label = str(path.relative_to(root)) if path == root or root in path.parents else "<source>"
        stats.extend((
            label, info.st_size, info.st_mtime_ns,
            getattr(info, "st_ctime_ns", None), getattr(info, "st_ino", None),
        ))
    stats.extend(_runtime_revision_state(song).items())
    stats.extend(_entity_revision_state(song).items())
    return tuple(stats)


def content_revision(song: models.Song) -> str:
    """Return a cached canonical revision while detecting semantic state changes cheaply."""
    with song_service.song_content_lock(song.id), song_service.library_write_lock():
        signature = _revision_signature(song)
        cached = revision_cache.get(song.id, signature)
        if cached is not None:
            return cached
        revision = compute_content_revision(song)
        revision_cache.put(song.id, signature, revision)
        return revision



def _fresh_song_or_none(db: Session, song_id: str) -> models.Song | None:
    song = song_service.get_song(db, song_id)
    if song is not None:
        db.refresh(song)
    return song


def _fresh_song(db: Session, song_id: str) -> models.Song:
    song = _fresh_song_or_none(db, song_id)
    if song is None:
        raise ValueError("Song not found")
    return song


def content_revision_for_song(db: Session, song_id: str) -> str:
    """Fingerprint the latest committed DB/runtime state under the snapshot locks."""
    with song_service.song_content_lock(song_id), song_service.library_write_lock():
        song = _fresh_song(db, song_id)
        if song.status != models.SongStatus.DONE:
            raise ValueError("Song processing is not complete")
        return content_revision(song)


def build_package_for_song(
    db: Session, song_id: str, *, expected_revision: str | None = None,
) -> tuple[Path, str]:
    """Export only from a fresh ORM snapshot loaded after acquiring the content locks."""
    with song_service.song_content_lock(song_id), song_service.library_write_lock():
        song = _fresh_song(db, song_id)
        if song.status != models.SongStatus.DONE:
            raise ValueError("Song processing is not complete")
        return build_package(song, expected_revision=expected_revision), song.slug

def invalidate_content_revision(song: models.Song) -> None:
    revision_cache.invalidate(song)

def _song_mode_from_files(output_dir: Path) -> str:
    try:
        song_map = json.loads((output_dir / "songMap.json").read_text(encoding="utf-8"))
        lyrics_sync = json.loads((output_dir / "lyricsSync.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError("Song timeline artifacts are invalid") from exc
    notes = song_map.get("notes", []) if isinstance(song_map, dict) else []
    words = song_map.get("words", []) if isinstance(song_map, dict) else []
    sync_words = lyrics_sync.get("words", []) if isinstance(lyrics_sync, dict) else []
    if isinstance(notes, list) and any(isinstance(item, dict) for item in notes):
        return "melody"
    if ((isinstance(words, list) and any(isinstance(item, dict) for item in words)) or
            (isinstance(sync_words, list) and any(isinstance(item, dict) for item in sync_words))):
        return "lyrics"
    return "instrumental"


def _manifest(song: models.Song) -> dict[str, object]:
    fields = (
        "id", "title", "artist", "genre", "original_filename", "slug",
        "key_override", "tempo_override", "note_range_min", "note_range_max",
        "difficulty_override", "video_url", "show_lyrics", "show_notes", "optimized",
    )
    output_dir = song_service.resolve_output_dir(song)
    mode = _song_mode_from_files(output_dir)
    runtime = _runtime_revision_state(song, mode=mode)
    values = {field: getattr(song, field) for field in fields}
    values.update(runtime)
    values.update(_entity_revision_state(song))
    return {
        "package_schema_version": PACKAGE_SCHEMA_VERSION,
        "karaoke_mode": mode,
        "content_revision": content_revision(song),
        **values,
    }


def build_package(song: models.Song, *, expected_revision: str | None = None) -> Path:
    """Create an immutable package snapshot for the requested canonical revision."""
    with song_service.song_content_lock(song.id), song_service.library_write_lock():
        source = song_service.resolve_source_path(song)
        output_dir = song_service.resolve_output_dir(song)
        if not source.is_file() or not output_dir.is_dir():
            raise ValueError("Song files are incomplete")
        current_revision = compute_content_revision(song)
        if expected_revision is not None and current_revision != expected_revision:
            raise ValueError("Song revision changed before package export")

        with tempfile.NamedTemporaryFile(
            prefix="karaoke-song-", suffix=".karaoke.zip", dir=config.CACHE_DIR, delete=False,
        ) as package:
            package_path = Path(package.name)
        try:
            manifest = _manifest(song)
            if manifest["content_revision"] != current_revision:
                raise ValueError("Song revision changed before package snapshot")
            with zipfile.ZipFile(package_path, "w", zipfile.ZIP_DEFLATED, compresslevel=4) as archive:
                archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
                archive.write(source, f"source/{source.name}")
                for path in output_dir.rglob("*"):
                    if path.is_symlink() or not path.is_file():
                        continue
                    relative = path.relative_to(output_dir)
                    if not song_artifacts.is_portable_output_path(relative):
                        continue
                    if path.name.startswith("take-") or path.name == "pipeline.log":
                        continue
                    if path.resolve() == source.resolve():
                        continue
                    archive.write(path, (PurePosixPath("output") / PurePosixPath(relative.as_posix())).as_posix())
            with zipfile.ZipFile(package_path) as archive:
                members = _safe_members(archive)
                exported_manifest = _read_manifest(archive)
                _validate_semantic_package(archive, members, exported_manifest)
                if exported_manifest.get("content_revision") != current_revision:
                    raise ValueError("Exported package revision differs from requested revision")
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


def _portable_destination_key(path: PurePosixPath) -> tuple[str, ...]:
    """Canonical Windows-portable key used before extracting untrusted packages."""
    result: list[str] = []
    for raw_part in path.parts:
        part = unicodedata.normalize("NFKC", raw_part).rstrip(" .")
        if not part:
            raise ValueError("Song package contains a Windows-unsafe path")
        stem = part.split(".", 1)[0].rstrip(" .").upper()
        if stem in _WINDOWS_RESERVED_NAMES:
            raise ValueError("Song package contains a Windows reserved path")
        result.append(part.casefold())
    return tuple(result)


def _final_destination(path: PurePosixPath, source_name: str | None = None) -> PurePosixPath | None:
    if path.parts[:1] == ("output",):
        if len(path.parts) == 1:
            return None
        return PurePosixPath(*path.parts[1:])
    if path.parts[:1] == ("source",) and source_name is not None:
        return PurePosixPath(source_name)
    return None


def _safe_members(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    members = archive.infolist()
    if len(members) > MAX_PACKAGE_FILES:
        raise ValueError("Song package contains too many files")
    total_size = sum(member.file_size for member in members)
    if total_size > MAX_PACKAGE_BYTES:
        raise ValueError("Song package is too large")
    normalized: set[tuple[str, ...]] = set()
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
        if path.parts[:1] == ("output",) and not song_artifacts.is_portable_output_path(
            PurePosixPath(*path.parts[1:])
        ):
            raise ValueError("Song package contains local-only/internal transaction metadata")
        key = _portable_destination_key(path)
        if key in normalized:
            raise ValueError("Song package contains duplicate/colliding paths")
        normalized.add(key)
    return members


def _read_manifest(archive: zipfile.ZipFile) -> dict[str, object]:
    try:
        info = archive.getinfo("manifest.json")
        if info.file_size > MAX_MANIFEST_BYTES:
            raise ValueError("Song package manifest is too large")
        with archive.open(info) as stream:
            payload = stream.read(MAX_MANIFEST_BYTES + 1)
        if len(payload) > MAX_MANIFEST_BYTES:
            raise ValueError("Song package manifest is too large")
        manifest = json.loads(payload)
    except (KeyError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError("Song package manifest is invalid") from exc
    if not isinstance(manifest, dict):
        raise ValueError("Song package manifest is invalid")
    return manifest




def _archive_json(archive: zipfile.ZipFile, name: str, *, max_bytes: int = MAX_MANIFEST_BYTES) -> object:
    try:
        info = archive.getinfo(name)
    except KeyError as exc:
        raise ValueError(f"Song package is missing required artifact: {name}") from exc
    if info.file_size > max_bytes:
        raise ValueError(f"Song package artifact is too large: {name}")
    with archive.open(info) as stream:
        payload = stream.read(max_bytes + 1)
    if len(payload) > max_bytes:
        raise ValueError(f"Song package artifact is too large: {name}")
    try:
        return json.loads(payload)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError(f"Song package artifact is invalid JSON: {name}") from exc


def _archive_processing_build_identity(archive: zipfile.ZipFile) -> str:
    payload = _archive_json(archive, "output/manifest.json")
    if not isinstance(payload, dict):
        raise ValueError("Song package processing manifest is invalid")
    build = payload.get("build") or payload.get("version")
    if not isinstance(build, str) or not build.strip():
        raise ValueError("Song package processing build identifier is invalid")
    return build.strip()


def _archive_revision(archive: zipfile.ZipFile, manifest: dict[str, object]) -> str:
    processing = _archive_json(archive, "output/manifest.json")
    if not isinstance(processing, dict) or not isinstance(processing.get("outputs"), dict):
        raise ValueError("Song package processing manifest is invalid")
    instrumental = _safe_output_relative(processing["outputs"].get("instrumental"), key="instrumental")
    artifacts: dict[str, str] = {}
    for relative in (*REVISION_ARTIFACTS, instrumental):
        name = f"output/{relative}"
        try:
            info = archive.getinfo(name)
        except KeyError as exc:
            raise ValueError(f"Song package is missing revision artifact: {name}") from exc
        digest = hashlib.sha256()
        with archive.open(info) as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
        artifacts[relative] = digest.hexdigest()
    mode = str(manifest.get("karaoke_mode") or "")
    runtime = _canonical_runtime_state({field: manifest.get(field) for field in REVISION_RUNTIME_FIELDS}, mode)
    source = _source_member(archive.infolist())
    source_digest = hashlib.sha256()
    with archive.open(source) as stream:
        while chunk := stream.read(1024 * 1024):
            source_digest.update(chunk)
    entity = _canonical_entity_state(
        {field: manifest.get(field) for field in REVISION_ENTITY_FIELDS},
        source_name=_member_path(source).name,
    )
    return _hash_revision_payload({
        "revision_schema": REVISION_SCHEMA_VERSION,
        "artifacts": artifacts,
        "source_sha256": source_digest.hexdigest(),
        "runtime": runtime,
        "entity": entity,
        "processing_build": _archive_processing_build_identity(archive),
    })

def _number(value: object) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


def _valid_note(item: object) -> bool:
    if not isinstance(item, dict):
        return False
    start = _number(item.get("start"))
    end = _number(item.get("end"))
    midi = _number(item.get("midi_note", item.get("midi")))
    return start is not None and end is not None and midi is not None and start >= 0 and end > start and 0 <= midi <= 127


def _valid_word(item: object) -> bool:
    if not isinstance(item, dict):
        return False
    start = _number(item.get("start"))
    end = _number(item.get("end"))
    text = str(item.get("word", item.get("text", ""))).strip()
    return bool(text) and start is not None and end is not None and start >= 0 and end > start


def _validate_wav_member(archive: zipfile.ZipFile, name: str) -> float:
    """Parse the actual WAV container and prove that it contains audio frames."""
    try:
        info = archive.getinfo(name)
        with archive.open(info) as stream, wave.open(stream, "rb") as audio:
            channels = audio.getnchannels()
            sample_width = audio.getsampwidth()
            sample_rate = audio.getframerate()
            frames = audio.getnframes()
            if channels <= 0 or sample_width <= 0 or sample_rate <= 0 or frames <= 0:
                raise ValueError
            first_frame = audio.readframes(1)
            if len(first_frame) < channels * sample_width:
                raise ValueError
            return frames / sample_rate
    except (KeyError, EOFError, wave.Error, OSError, ValueError) as exc:
        raise ValueError(f"Song package contains invalid WAV audio: {name}") from exc


def _validate_archive_audio(
    archive: zipfile.ZipFile, member: zipfile.ZipInfo, *, label: str, min_duration: float = 0.02,
) -> None:
    suffix = Path(_member_path(member).name).suffix.lower()
    if suffix not in config.ALLOWED_AUDIO_EXTENSIONS:
        raise ValueError(f"Song package {label} format is not supported")
    if suffix == ".wav":
        if _validate_wav_member(archive, member.filename) <= min_duration:
            raise ValueError(f"Song package {label} audio has no usable duration")
        return
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix=f"karaoke-{label}-probe-", suffix=suffix, dir=config.CACHE_DIR, delete=False,
        ) as temp:
            temp_path = Path(temp.name)
            with archive.open(member) as source:
                shutil.copyfileobj(source, temp, length=1024 * 1024)
        probe = config.resolve_runtime_executable("ffprobe")
        result = subprocess.run(
            [probe, "-v", "error", "-select_streams", "a:0", "-show_entries",
             "stream=codec_type,duration:format=duration", "-of", "json", str(temp_path)],
            capture_output=True, text=True, timeout=15, check=False,
        )
        if result.returncode != 0:
            raise ValueError(f"Song package {label} audio cannot be decoded")
        payload = json.loads(result.stdout or "{}")
        streams = payload.get("streams", []) if isinstance(payload, dict) else []
        durations = []
        if isinstance(payload, dict):
            fmt = payload.get("format")
            durations.append(_number(fmt.get("duration") if isinstance(fmt, dict) else None))
        if isinstance(streams, list):
            durations.extend(
                _number(item.get("duration"))
                for item in streams
                if isinstance(item, dict) and item.get("codec_type") == "audio"
            )
        has_audio = isinstance(streams, list) and any(
            isinstance(item, dict) and item.get("codec_type") == "audio" for item in streams
        )
        if not has_audio or not any(duration is not None and duration > min_duration for duration in durations):
            raise ValueError(f"Song package {label} audio has no usable duration")
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as exc:
        raise ValueError(f"Song package {label} audio cannot be probed") from exc
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def _validate_source_audio(archive: zipfile.ZipFile, member: zipfile.ZipInfo) -> None:
    _validate_archive_audio(archive, member, label="source")


def _instrumental_member(archive: zipfile.ZipFile) -> zipfile.ZipInfo:
    processing = _archive_json(archive, "output/manifest.json")
    if not isinstance(processing, dict) or not isinstance(processing.get("outputs"), dict):
        raise ValueError("Song package processing manifest is invalid")
    relative = _safe_output_relative(processing["outputs"].get("instrumental"), key="instrumental")
    try:
        return archive.getinfo(f"output/{relative}")
    except KeyError as exc:
        raise ValueError("Song package manifest points to missing artifact: instrumental") from exc


def _validate_processing_manifest(archive: zipfile.ZipFile, files: set[str]) -> None:
    pipeline_manifest = _archive_json(archive, "output/manifest.json")
    if not isinstance(pipeline_manifest, dict) or not isinstance(pipeline_manifest.get("outputs"), dict):
        raise ValueError("Song package processing manifest is invalid")
    outputs = pipeline_manifest["outputs"]
    if not REQUIRED_OUTPUT_KEYS.issubset(outputs):
        raise ValueError("Song package processing manifest is incomplete")
    build = pipeline_manifest.get("build") or pipeline_manifest.get("version")
    if not isinstance(build, str) or not build.strip():
        raise ValueError("Song package processing build identifier is invalid")
    integrity = pipeline_manifest.get("integrity")
    for key in REQUIRED_OUTPUT_KEYS:
        relative = outputs.get(key)
        if not isinstance(relative, str) or f"output/{relative}" not in files:
            raise ValueError(f"Song package manifest points to missing artifact: {key}")
        expected = integrity.get(key) if isinstance(integrity, dict) else None
        if not (isinstance(expected, dict) and isinstance(expected.get("sha256"), str)):
            continue
        digest = hashlib.sha256()
        with archive.open(f"output/{relative}") as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
        if digest.hexdigest() != expected["sha256"]:
            raise ValueError(f"Song package artifact checksum mismatch: {key}")


def _validate_timeline_artifacts(archive: zipfile.ZipFile, mode: object) -> None:
    song_map = _archive_json(archive, "output/songMap.json", max_bytes=16 * 1024 * 1024)
    if not isinstance(song_map, dict) or not all(isinstance(song_map.get(key), list) for key in ("words", "syllables", "notes")):
        raise ValueError("Song package songMap.json is structurally invalid")
    notes = [item for item in song_map["notes"] if _valid_note(item)]
    if len(notes) != len(song_map["notes"]):
        raise ValueError("Song package contains invalid songMap notes")

    reference = _archive_json(archive, "output/reference.json", max_bytes=16 * 1024 * 1024)
    if not isinstance(reference, dict) or not isinstance(reference.get("notes"), list):
        raise ValueError("Song package reference.json is structurally invalid")
    reference_notes = [item for item in reference["notes"] if _valid_note(item)]
    if len(reference_notes) != len(reference["notes"]):
        raise ValueError("Song package contains invalid reference notes")

    lyrics_sync = _archive_json(archive, "output/lyricsSync.json", max_bytes=16 * 1024 * 1024)
    if not isinstance(lyrics_sync, dict) or not isinstance(lyrics_sync.get("words", []), list):
        raise ValueError("Song package lyricsSync.json is structurally invalid")
    sync_words = lyrics_sync.get("words", [])
    valid_words = [item for item in sync_words if _valid_word(item)]
    if len(valid_words) != len(sync_words):
        raise ValueError("Song package contains invalid lyric timing")

    if mode == "melody":
        if not notes or not reference_notes or len(notes) != len(reference_notes):
            raise ValueError("Melody package reference notes are incomplete")
        for song_note, ref_note in zip(notes, reference_notes, strict=True):
            song_tuple = (_number(song_note.get("start")), _number(song_note.get("end")), _number(song_note.get("midi_note", song_note.get("midi"))))
            ref_tuple = (_number(ref_note.get("start")), _number(ref_note.get("end")), _number(ref_note.get("midi_note", ref_note.get("midi"))))
            if any(a is None or b is None or abs(a - b) > 1e-4 for a, b in zip(song_tuple, ref_tuple, strict=True)):
                raise ValueError("songMap and reference notes disagree")
    elif mode == "lyrics" and not valid_words:
        raise ValueError("Lyrics package has no timed words")


def _validate_semantic_package(archive: zipfile.ZipFile, members: list[zipfile.ZipInfo], manifest: dict[str, object]) -> None:
    if manifest.get("package_schema_version") != PACKAGE_SCHEMA_VERSION:
        raise ValueError("Unsupported or missing song package schema version")
    mode = manifest.get("karaoke_mode")
    if mode not in {"melody", "lyrics", "instrumental"}:
        raise ValueError("Song package has no supported karaoke mode")
    revision = manifest.get("content_revision")
    if not isinstance(revision, str) or not revision.startswith("sha256:") or len(revision) != 71:
        raise ValueError("Song package has no valid content revision")
    if revision != _archive_revision(archive, manifest):
        raise ValueError("Song package content revision does not match its artifacts")

    files = {member.filename for member in members if not member.is_dir()}
    missing = {f"output/{name}" for name in REQUIRED_OUTPUT_PATHS} - files
    if missing:
        raise ValueError(f"Song package is incomplete; missing: {', '.join(sorted(missing))}")
    _validate_archive_audio(archive, _instrumental_member(archive), label="instrumental")
    source = _source_member(members)
    _validate_source_audio(archive, source)
    _validate_processing_manifest(archive, files)
    _validate_timeline_artifacts(archive, mode)


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
        relative = PurePosixPath(*parts[1:])
        if not song_artifacts.is_portable_output_path(relative):
            raise ValueError("Song package contains local-only/internal transaction metadata")
        _copy_archive_member(archive, member, destination / Path(*relative.parts))


def _song_from_manifest(
    manifest: dict[str, object],
    *,
    song_id: str,
    title: str,
    slug: str,
    source_path: Path,
    output_dir: Path,
) -> models.Song:
    runtime = _canonical_runtime_state(
        {field: manifest.get(field) for field in REVISION_RUNTIME_FIELDS},
        str(manifest.get("karaoke_mode") or ""),
    )
    entity = _canonical_entity_state(
        {field: manifest.get(field) for field in REVISION_ENTITY_FIELDS}, source_name=source_path.name
    )
    return models.Song(
        id=song_id,
        title=entity["title"] or title,
        artist=entity["artist"],
        genre=entity["genre"],
        original_filename=entity["original_filename"],
        source_path=str(source_path),
        slug=slug,
        output_dir=str(output_dir),
        status=models.SongStatus.DONE,
        progress_step="imported",
        progress_percent=100.0,
        key_override=runtime["key_override"],
        tempo_override=runtime["tempo_override"],
        note_range_min=runtime["note_range_min"],
        note_range_max=runtime["note_range_max"],
        difficulty_override=runtime["difficulty_override"],
        video_url=runtime["video_url"],
        show_lyrics=runtime["show_lyrics"],
        show_notes=runtime["show_notes"],
        optimized=runtime["optimized"],
    )


def _apply_imported_song(target: models.Song, incoming: models.Song) -> None:
    for field in (
        "title", "artist", "genre", "original_filename", "source_path", "output_dir",
        "status", "progress_step", "progress_percent", "error_message", "key_override",
        "tempo_override", "note_range_min", "note_range_max", "difficulty_override",
        "video_url", "show_lyrics", "show_notes", "optimized",
    ):
        setattr(target, field, getattr(incoming, field))


def _same_revision(song: models.Song, revision: object) -> bool:
    if not isinstance(revision, str):
        return False
    try:
        return content_revision(song) == revision
    except (OSError, ValueError, AttributeError, TypeError):
        return False


def _validate_destination_names(members: list[zipfile.ZipInfo], final_source_name: str) -> None:
    destinations: set[tuple[str, ...]] = {_portable_destination_key(PurePosixPath(final_source_name))}
    for member in members:
        if member.is_dir():
            continue
        path = _member_path(member)
        destination = _final_destination(path, final_source_name)
        if destination is None or path.parts[:1] == ("source",):
            continue
        key = _portable_destination_key(destination)
        if key in destinations:
            raise ValueError("Song package namespaces collide on the destination filesystem")
        destinations.add(key)


def _prepare_publish_tree(
    archive: zipfile.ZipFile, members: list[zipfile.ZipInfo], source_member: zipfile.ZipInfo,
    staging_root: Path, final_source_name: str,
) -> Path:
    staged_source = staging_root / "source" / final_source_name
    staged_output = staging_root / "output"
    publish = staging_root / "publish"
    publish.mkdir()
    _copy_archive_member(archive, source_member, staged_source)
    _extract_output(archive, members, staged_output)
    shutil.copy2(staged_source, publish / final_source_name)
    for item in staged_output.iterdir() if staged_output.exists() else ():
        target = publish / item.name
        if item.is_dir():
            shutil.copytree(item, target)
        else:
            shutil.copy2(item, target)
    return publish


def _trusted_library_roots() -> set[Path]:
    return {
        config.SONG_OUTPUT_DIR.resolve(),
        *(Path(root).resolve() for root in config.SONG_LIBRARY_ROOTS),
    }


def _safe_library_root(value: object) -> Path:
    if not isinstance(value, str) or not value or "\x00" in value:
        raise ValueError("Room import recovery journal is invalid")
    candidate = Path(value).expanduser().resolve()
    if candidate not in _trusted_library_roots():
        raise ValueError("Room import recovery journal references an untrusted library root")
    return candidate


def _safe_library_entry(name: object, *, root: Path | None = None) -> Path:
    if not isinstance(name, str) or not name or any(token in name for token in ("/", "\\", ":", "\x00")):
        raise ValueError("Room import recovery journal is invalid")
    trusted_root = (root or config.SONG_OUTPUT_DIR).resolve()
    if trusted_root not in _trusted_library_roots():
        raise ValueError("Room import recovery journal references an untrusted library root")
    candidate = (trusted_root / name).resolve()
    if candidate.parent != trusted_root:
        raise ValueError("Room import recovery journal escapes the library root")
    return candidate


def _preserve_local_output(backup_dir: Path | None, output_dir: Path) -> None:
    if backup_dir is None or not backup_dir.exists() or not output_dir.exists():
        return
    for dirname in _SKIPPED_DIRS:
        old_local, new_local = backup_dir / dirname, output_dir / dirname
        if old_local.exists():
            if new_local.exists():
                raise ValueError(f"Portable package collided with local-only directory: {dirname}")
            old_local.replace(new_local)


def _import_journal_path(output_dir: Path) -> Path:
    root = output_dir.resolve().parent
    if root not in _trusted_library_roots():
        raise ValueError("Song output directory is outside the trusted library roots")
    return root / f"{_IMPORT_JOURNAL_PREFIX}{uuid4().hex}.json"


def _write_import_journal(path: Path, payload: dict[str, object], phase: str) -> None:
    current = dict(payload)
    current["phase"] = phase
    write_json(path, current)


def _recover_import_journal(db: Session, journal_path: Path) -> None:
    journal = read_json(journal_path, default={})
    if not isinstance(journal, dict):
        raise ValueError("Room import recovery journal is invalid")
    phase = journal.get("phase")
    if phase not in {"prepared", "backup-created", "published", "db-committed"}:
        raise ValueError("Room import recovery journal is invalid")
    song_id, revision = journal.get("song_id"), journal.get("new_revision")
    if not isinstance(song_id, str) or not isinstance(revision, str):
        raise ValueError("Room import recovery journal is invalid")
    root_value = journal.get("library_root")
    # Round17 journals did not store a root. They are safe to interpret only
    # relative to the trusted root that physically contains the journal.
    root = _safe_library_root(root_value) if root_value is not None else _safe_library_root(str(journal_path.parent))
    if journal_path.resolve().parent != root:
        raise ValueError("Room import recovery journal is stored under a different library root")
    output_dir = _safe_library_entry(journal.get("target"), root=root)
    backup_name = journal.get("backup")
    backup_dir = _safe_library_entry(backup_name, root=root) if backup_name else None

    # Before the first rename there is no filesystem state to reconcile.
    if phase == "prepared":
        journal_path.unlink(missing_ok=True)
        return

    song = _fresh_song_or_none(db, song_id)
    committed = False
    if song is not None and output_dir.exists():
        try:
            committed = compute_content_revision(song) == revision
        except (OSError, ValueError, TypeError, AttributeError):
            committed = False

    if committed or phase == "db-committed":
        # phase=db-committed is written only after commit() returns. The revision
        # check above additionally handles a crash after DB commit but before phase update.
        if not committed:
            raise ValueError("Room import recovery found a committed journal with mismatched DB state")
        _preserve_local_output(backup_dir, output_dir)
        if backup_dir is not None:
            shutil.rmtree(backup_dir, ignore_errors=True)
        journal_path.unlink(missing_ok=True)
        revision_cache.invalidate(song)
        return

    # DB still describes the old generation: restore the old tree exactly.
    if output_dir.exists():
        shutil.rmtree(output_dir, ignore_errors=True)
    if backup_dir is not None and backup_dir.exists():
        backup_dir.replace(output_dir)
    journal_path.unlink(missing_ok=True)


def recover_import_transactions() -> None:
    """Reconcile durable peer-import journals after hard process/power loss."""
    roots = sorted(_trusted_library_roots(), key=lambda path: str(path).casefold())
    journals = [
        journal
        for root in roots if root.exists()
        for journal in sorted(root.glob(f"{_IMPORT_JOURNAL_PREFIX}*.json"))
    ]
    if not journals:
        return
    db = SessionLocal()
    try:
        for journal_path in journals:
            try:
                _recover_import_journal(db, journal_path)
            except Exception:
                db.rollback()
                # Fail closed: leave the journal/backups for diagnostics rather
                # than guessing and deleting user data.
                continue
    finally:
        db.close()


def _publish_imported_package(
    db: Session, archive: zipfile.ZipFile, members: list[zipfile.ZipInfo],
    manifest: dict[str, object], existing: models.Song | None, source_member: zipfile.ZipInfo,
    *, song_id: str, title: str, slug: str, final_source_name: str, output_dir: Path,
) -> models.Song:
    staging_root = Path(tempfile.mkdtemp(prefix="song-import-", dir=config.CACHE_DIR))
    backup_dir = output_dir.with_name(f".{output_dir.name}.room-backup-{uuid4().hex}") if existing else None
    journal_path = _import_journal_path(output_dir)
    published = False
    db_committed = False
    journal = {
        "operation": "room-import",
        "song_id": song_id,
        "library_root": str(output_dir.resolve().parent),
        "target": output_dir.name,
        "backup": backup_dir.name if backup_dir is not None else None,
        "new_revision": manifest.get("content_revision"),
    }
    try:
        publish = _prepare_publish_tree(archive, members, source_member, staging_root, final_source_name)
        _write_import_journal(journal_path, journal, "prepared")
        if existing is not None:
            output_dir.replace(backup_dir)
            _write_import_journal(journal_path, journal, "backup-created")
        publish.replace(output_dir)
        published = True
        _write_import_journal(journal_path, journal, "published")

        import_manifest = dict(manifest)
        import_manifest.setdefault("original_filename", _member_path(source_member).name)
        incoming = _song_from_manifest(
            import_manifest, song_id=song_id, title=title, slug=slug,
            source_path=output_dir / final_source_name, output_dir=output_dir,
        )
        if compute_content_revision(incoming) != manifest.get("content_revision"):
            raise ValueError("Imported song would not preserve the package content revision")
        if existing is None:
            db.add(incoming)
            saved = commit_refresh(db, incoming)
        else:
            _apply_imported_song(existing, incoming)
            saved = commit_refresh(db, existing)
        db_committed = True
        # If this phase write itself fails, the durable "published" journal is
        # still sufficient: startup recovery verifies DB revision and completes cleanup.
        try:
            _write_import_journal(journal_path, journal, "db-committed")
        except OSError:
            pass

        # Local user/device state is merged only after the DB transition is durable.
        # Recovery can therefore finish this step safely after a hard crash.
        _preserve_local_output(backup_dir, output_dir)
        if backup_dir is not None:
            shutil.rmtree(backup_dir, ignore_errors=True)
        shutil.rmtree(staging_root, ignore_errors=True)
        journal_path.unlink(missing_ok=True)
        revision_cache.invalidate(saved)
        return saved
    except Exception:
        if db_committed:
            # Never compensate the filesystem back to the old generation after
            # a durable DB commit. Leave journal/backup for startup recovery.
            shutil.rmtree(staging_root, ignore_errors=True)
            raise
        db.rollback()
        if published and output_dir.exists():
            shutil.rmtree(output_dir, ignore_errors=True)
        if backup_dir is not None and backup_dir.exists() and not output_dir.exists():
            backup_dir.replace(output_dir)
        shutil.rmtree(staging_root, ignore_errors=True)
        journal_path.unlink(missing_ok=True)
        raise

def import_package(db: Session, package_path: Path, *, expected_revision: str | None = None) -> models.Song:
    """Import a peer package only when it is the exact revision requested by the room command."""
    with zipfile.ZipFile(package_path) as archive:
        members = _safe_members(archive)
        manifest = _read_manifest(archive)
        _validate_semantic_package(archive, members, manifest)
        song_id, title = _package_identity(manifest)
        revision = manifest["content_revision"]
        if expected_revision is not None and revision != expected_revision:
            raise ValueError("Imported package revision differs from the expected room revision")
        source_member = _source_member(members)
        extension = Path(_member_path(source_member).name).suffix.lower()
        final_source_name = f"source{extension}"
        _validate_destination_names(members, final_source_name)
        base_slug = song_service.slugify(str(manifest.get("slug") or title), "song")
        # Replacing canonical song files while a microphone take is live would
        # make stop_recording() mix/save against a different generation.
        from app.services import recording_service
        if recording_service.has_active_recording(song_id):
            raise ValueError("Cannot replace a song while a recording session is active")
        with song_service.song_content_lock(song_id), song_service.library_write_lock():
            existing = _fresh_song_or_none(db, song_id)
            if existing is not None and _same_revision(existing, revision):
                return existing
            slug = existing.slug if existing is not None else song_service.make_unique_slug(db, base_slug)
            output_dir = song_service.resolve_output_dir(existing) if existing is not None else config.SONG_OUTPUT_DIR / slug
            return _publish_imported_package(
                db, archive, members, manifest, existing, source_member,
                song_id=song_id, title=title, slug=slug,
                final_source_name=final_source_name, output_dir=output_dir,
            )

