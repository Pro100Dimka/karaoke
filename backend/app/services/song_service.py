
import base64
import contextlib
import re
import threading
import unicodedata
import weakref
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

import config
import models
import schemas
from app import repositories
from app.services import revision_cache
from app.services._metadata import first_audio_tag
from app.services.db_utils import commit_refresh
from app.services.resource_deletion import delete_with_files
from app.utils.atomic_files import atomic_write_bytes, move_path

_first_audio_tag = first_audio_tag

_library_write_lock = threading.RLock()
_content_locks_guard = threading.Lock()
_content_locks: weakref.WeakValueDictionary[str,
                                            threading.RLock] = weakref.WeakValueDictionary()


class SongAlreadyExistsError(ValueError):
    pass


@contextmanager
def library_write_lock():
    with _library_write_lock: yield


@contextmanager
def song_content_lock(song_id: object):
    key = str(song_id)
    with _content_locks_guard: lock = _content_locks.setdefault(key, threading.RLock())
    with lock: yield


def _slug_has_files(slug: str) -> bool: return (config.SONG_OUTPUT_DIR / slug).exists()


def _slug_exists(db: Session, slug: str) -> bool: return db.query(models.Song.id).filter(models.Song.slug == slug).first() is not None


def _ensure_path_within(path: Path, root: Path) -> Path:
    resolved_path, resolved_root = path.resolve(), root.resolve()
    if resolved_path == resolved_root or resolved_root in resolved_path.parents: return resolved_path
    raise ValueError("Song file path is outside the application library")


def resolve_library_path(path: Path) -> Path:
    errors, roots = [], {config.SONG_OUTPUT_DIR.resolve(), *(Path(root).resolve() for root in config.SONG_LIBRARY_ROOTS)}
    for root in roots:
        try:
            return _ensure_path_within(path, root)
        except ValueError as exc:
            errors.append(exc)
    raise ValueError("Song file path is outside the application library") from (
        errors[-1] if errors else None)


def resolve_source_path(song: models.Song) -> Path: return resolve_library_path(Path(song.source_path))


def resolve_output_dir(song: models.Song) -> Path:
    path = Path(
        song.output_dir) if song.output_dir else config.SONG_OUTPUT_DIR / song.slug
    return resolve_library_path(path)


def _cover_extension(payload: bytes) -> str | None:
    if payload.startswith(b"\xff\xd8\xff"): return ".jpg"
    if payload.startswith(b"\x89PNG\r\n\x1a\n"): return ".png"
    return '.webp' if payload.startswith(b'RIFF') and payload[8:12] == b'WEBP' else None


def extract_embedded_cover(source_path: Path, output_dir: Path) -> Path | None:
    try:
        from mutagen import File as MutagenFile

        audio = MutagenFile(source_path)
    except Exception:
        return None
    if audio is None: return None

    candidates = [
        data for picture in (getattr(audio, "pictures", ()) or ())
        if isinstance(data := getattr(picture, "data", None), bytes) and data
    ]

    if (
        (tags := getattr(audio, "tags", None)) is not None
        and callable(values := getattr(tags, "values", None))
    ):
        candidates.extend(
            data for value in values()
            if isinstance(data := getattr(value, "data", None), bytes) and data
        )

    if tags is not None and callable(get := getattr(tags, "get", None)):
        if isinstance(covers := get("covr"), (list, tuple)): candidates.extend(bytes(item) for item in covers if item)

        for key in ("coverart", "COVERART"):
            values = get(key)
            if not isinstance(values, (list, tuple)): values = [values] if values else []
            for value in values:
                if isinstance(value, str):
                    with contextlib.suppress(ValueError): candidates.append(base64.b64decode(value, validate=True))

        for key in ("metadata_block_picture", "METADATA_BLOCK_PICTURE"):
            values = get(key)
            if not isinstance(values, (list, tuple)): values = [values] if values else []
            for value in values:
                if not isinstance(value, str): continue
                with contextlib.suppress(ValueError, TypeError, ImportError):
                    from mutagen.flac import Picture

                    picture = Picture(base64.b64decode(value, validate=True))
                    if picture.data: candidates.append(picture.data)

    for payload in candidates:
        extension = _cover_extension(payload)
        if extension is None: continue
        target = output_dir / f"cover{extension}"
        atomic_write_bytes(target, payload)
        return target
    return None



_COPY_SUFFIX_RE = re.compile(r"\s*\(\d+\)\s*$")
_WINDOWS_FORBIDDEN_RE = re.compile(r'[<>:"/\\|?*]+')
_RELEASE_WORD_RE = re.compile(r"\b(?:single|album|ep)\b", re.IGNORECASE)
_YEAR_RE = re.compile(r"[\[(]\s*(?:19|20)\d{2}\s*[\])]")


def _clean_copy_suffix(value: str) -> str: return _COPY_SUFFIX_RE.sub('', value).strip()


def _identity_words(value: str | None) -> list[str]: return [part for part in re.split('\\s+', str(value or '').strip()) if part]


def _normalize_artist_title(
    artist: str | None, title: str | None, album: str | None = None
) -> tuple[str | None, str]:
    raw_artist, clean_title = str(artist or '').strip(), str(title or '').strip()
    value = raw_artist
    if album:
        value = re.sub(re.escape(str(album).strip()),
                       " ", value, flags=re.IGNORECASE)
    if clean_title: value = re.sub(re.escape(clean_title), " ", value, flags=re.IGNORECASE)
    value = _RELEASE_WORD_RE.sub(" ", value)
    value = _YEAR_RE.sub(" ", value)
    value = " ".join(re.sub(r"\s*[-–—]+\s*", " ", value).split())

    artist_words, title_words = _identity_words(value), _identity_words(clean_title)
    shared: list[str] = []
    for left, right in zip(artist_words, title_words, strict=False):
        if left.casefold() != right.casefold(): break
        shared.append(left)
    if shared and len(shared) < len(artist_words): value = " ".join(shared)

    if value and clean_title:
        prefix = value + " "
        if clean_title.casefold().startswith(prefix.casefold()): clean_title = clean_title[len(prefix):].strip() or clean_title
    return (value or None), clean_title


def parse_filename_identity(filename: str) -> tuple[str | None, str]:
    stem = _clean_copy_suffix(Path(filename).stem.strip())
    if not stem: return None, "song"

    spaced = re.split(r"\s+[-–—]\s+", stem, maxsplit=1)
    if len(spaced) == 2 and all(part.strip() for part in spaced): return spaced[0].strip(), spaced[1].strip()

    if compact := re.match(r"^(.+?)[–—-](.+)$", stem):
        artist = compact.group(1).strip()
        title = compact.group(2).strip()
        if artist and title and any(ch.isalpha() for ch in artist): return artist, title

    return None, stem


def _read_source_identity(
    source_path: Path, original_filename: str, requested_title: str
) -> tuple[str | None, str]:
    tagged_title: str | None = None
    tagged_artist: str | None = None
    tagged_album: str | None = None
    try:
        from mutagen import File as MutagenFile

        tags = MutagenFile(source_path, easy=True)
        if tags is not None:
            tagged_title = first_audio_tag(tags, "title")
            tagged_artist = first_audio_tag(tags, "artist", "albumartist")
            tagged_album = first_audio_tag(tags, "album")
    except Exception:
        pass

    filename_artist, filename_title = parse_filename_identity(
        original_filename)
    if tagged_title:
        artist, clean_title = _normalize_artist_title(
            tagged_artist, tagged_title, tagged_album)
        return artist or filename_artist, clean_title

    return (filename_artist, filename_title) if filename_artist else (None, requested_title.strip() or filename_title)


_WINDOWS_RESERVED_NAMES = {"CON", "PRN", "AUX", "NUL", *
                           (f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}


def _windows_safe_component(value: str, fallback: str) -> str:
    value = unicodedata.normalize("NFC", value).rstrip(" .")
    stem = value.split(".", 1)[0].rstrip(" .").upper()
    if stem in _WINDOWS_RESERVED_NAMES: value = f"_{value}"
    return value or fallback


def _folder_name(artist: str | None, title: str, fallback: str) -> str:
    identity = " ".join(part for part in (artist, title)
                        if part and part.strip()).strip()
    value = _WINDOWS_FORBIDDEN_RE.sub(" ", identity)
    value = " ".join(value.split()).rstrip(" .")
    return _windows_safe_component(value[:180], fallback)


def _unique_output_dir(base_name: str) -> Path:
    candidate, suffix = config.SONG_OUTPUT_DIR / base_name, 2
    while candidate.exists():
        candidate = config.SONG_OUTPUT_DIR / f"{base_name} ({suffix})"
        suffix += 1
    return candidate


def slugify(title: str, fallback: str) -> str:
    normalized = unicodedata.normalize("NFKD", title)
    ascii_ish = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_ish).strip("-").lower()
    return slug or fallback


def make_unique_slug(db: Session, base_slug: str) -> str:
    slug, suffix = base_slug, 2
    while _slug_exists(db, slug) or _slug_has_files(slug):
        slug = f"{base_slug}-{suffix}"
        suffix += 1
    return slug


def _song_input(title: str, original_filename: str) -> tuple[str, str, str]:
    safe_original_name = Path(original_filename).name.strip() or "song"
    extension = Path(safe_original_name).suffix.lower()
    if extension not in config.ALLOWED_AUDIO_EXTENSIONS:
        raise ValueError(
            f"Неподдерживаемый формат файла: {extension or '(нет расширения)'}. "
            f"Разрешено: {', '.join(sorted(config.ALLOWED_AUDIO_EXTENSIONS))}"
        )
    clean_title = title.strip() or Path(safe_original_name).stem
    return clean_title, safe_original_name, extension


def _identity_key(artist: str | None, title: str) -> str:
    value = " ".join(part for part in (artist, title) if part)
    value = unicodedata.normalize("NFKC", value).casefold()
    return " ".join(re.sub(r"[^\w]+", " ", value).split())


def _find_duplicate(db: Session, artist: str | None, title: str) -> models.Song | None:
    del artist
    expected = _identity_key(None, title)
    if not expected: return None
    songs = db.scalars(select(models.Song))
    if not hasattr(songs, "__iter__"): return None
    for song in songs:
        if _identity_key(None, song.title) == expected: return song
    return None


def _persist_song(
    db: Session,
    *,
    title: str,
    artist: str | None,
    original_filename: str,
    extension: str,
    write_source,
) -> models.Song:
    identity = " ".join(part for part in (
        artist, title) if part).strip() or title
    base_slug = slugify(identity, fallback="song")
    with library_write_lock():
        if _find_duplicate(db, artist, title) is not None:
            raise SongAlreadyExistsError("Такая песня уже существует")
        slug = make_unique_slug(db, base_slug)
        folder_base = _folder_name(artist, title, slug) if artist else slug
        output_dir = _unique_output_dir(folder_base)
        destination = output_dir / f"source{extension}"
        write_source(destination)
        extract_embedded_cover(destination, output_dir)
        song = models.Song(
            title=title,
            artist=artist,
            original_filename=original_filename,
            source_path=str(destination),
            slug=slug,
            output_dir=str(output_dir),
            status=models.SongStatus.PENDING,
        )
        db.add(song)
        try:
            saved = commit_refresh(db, song)
            revision_cache.invalidate(saved)
            return saved
        except Exception:
            destination.unlink(missing_ok=True)
            for cover in output_dir.glob("cover.*"): cover.unlink(missing_ok=True)
            with contextlib.suppress(OSError): output_dir.rmdir()
            raise


def create_song(db: Session, title: str, original_filename: str, file_bytes: bytes) -> models.Song:
    clean_title, safe_name, extension = _song_input(title, original_filename)
    if not file_bytes: raise ValueError("Audio file is empty")
    parsed_artist, parsed_title = parse_filename_identity(safe_name)
    if title.strip(): parsed_title = clean_title
    return _persist_song(
        db,
        title=parsed_title,
        artist=parsed_artist,
        original_filename=safe_name,
        extension=extension,
        write_source=lambda destination: atomic_write_bytes(
            destination, file_bytes),
    )


def create_song_from_path(
    db: Session,
    title: str,
    original_filename: str,
    temporary_source: Path,
    artist: str | None = None,
) -> models.Song:
    clean_title, safe_name, extension = _song_input(title, original_filename)
    if not temporary_source.is_file() or temporary_source.stat().st_size == 0: raise ValueError("Audio file is empty")

    detected_artist, detected_title = _read_source_identity(
        temporary_source, safe_name, clean_title)
    resolved_title = clean_title if title.strip() else detected_title
    resolved_artist = artist.strip() or None if artist is not None else detected_artist

    def move_source(destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        move_path(temporary_source, destination)

    return _persist_song(
        db,
        title=resolved_title,
        artist=resolved_artist,
        original_filename=safe_name,
        extension=extension,
        write_source=move_source,
    )


def list_songs(db: Session) -> list[models.Song]:
    return list(
        db.scalars(select(models.Song).order_by(models.Song.created_at.desc(), models.Song.id.desc()))
    )


def get_song(db: Session, song_id: str) -> models.Song | None: return repositories.get_song(db, song_id)


def update_song(db: Session, song: models.Song, patch: schemas.SongUpdate) -> models.Song:
    changes = patch.model_dump(exclude_unset=True)
    note_min, note_max = changes.get('note_range_min', getattr(song, 'note_range_min', None)), changes.get('note_range_max', getattr(song, 'note_range_max', None))
    if note_min is not None and note_max is not None and note_min > note_max: raise ValueError("note_range_min must not exceed note_range_max")
    with library_write_lock():
        previous = {field: getattr(song, field) for field in changes}
        previous_edit_flags = (
            getattr(song, "key_user_edited", False),
            getattr(song, "tempo_user_edited", False),
        )
        for field, value in changes.items(): setattr(song, field, value)
        if "key_override" in changes: song.key_user_edited = changes["key_override"] is not None
        if "tempo_override" in changes: song.tempo_user_edited = changes["tempo_override"] is not None
        try:
            saved = commit_refresh(db, song)
            revision_cache.invalidate(saved)
            return saved
        except Exception:
            for field, value in previous.items(): setattr(song, field, value)
            if hasattr(song, "key_user_edited"): song.key_user_edited = previous_edit_flags[0]
            if hasattr(song, "tempo_user_edited"): song.tempo_user_edited = previous_edit_flags[1]
            raise


def delete_song(db: Session, song: models.Song) -> None:
    output_dir, source_path = resolve_output_dir(song), resolve_source_path(song)
    paths = (
        (output_dir,)
        if output_dir == source_path or output_dir in source_path.parents
        else (
            output_dir,
            source_path,
        )
    )
    song_id = song.id
    delete_with_files(db, song, paths)
    revision_cache.invalidate(song_id)
