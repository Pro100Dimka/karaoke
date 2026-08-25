from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock

import pytest

import schemas
from app.services import song_service
from tests._shared import make_song, patch_attrs, patch_many, raises


def test_library_lock_and_owned_path_validation(monkeypatch, tmp_path):
    root = tmp_path / "library"
    root.mkdir()
    monkeypatch.setattr(song_service.config, "SONG_OUTPUT_DIR", root)
    with song_service.library_write_lock(): pass
    assert song_service._ensure_path_within(root, root) == root.resolve()
    nested = root / "song/source.wav"
    assert song_service._ensure_path_within(nested, root) == nested.resolve()
    raises(ValueError, lambda: song_service._ensure_path_within(tmp_path / 'outside', root), match='outside')

    current = make_song(source_path=str(nested), output_dir=None)
    assert (song_service.resolve_source_path(current) == nested.resolve()) and (song_service.resolve_output_dir(current) == (root / 'song').resolve())


def test_original_source_retired_detects_instrumental_takeover(monkeypatch, tmp_path):
    root = tmp_path / "library"
    root.mkdir()
    monkeypatch.setattr(song_service.config, "SONG_OUTPUT_DIR", root)
    output_dir = root / "song"
    output_dir.mkdir()
    instrumental = output_dir / "instrumental.flac"
    instrumental.write_bytes(b"data")

    still_original = make_song(source_path=str(output_dir / "source.wav"), output_dir=str(output_dir))
    assert song_service.original_source_retired(still_original) is False

    retired = make_song(source_path=str(instrumental), output_dir=str(output_dir))
    assert song_service.original_source_retired(retired) is True

    outside = make_song(source_path=str(tmp_path / "outside.wav"), output_dir=str(output_dir))
    assert song_service.original_source_retired(outside) is False


def test_slug_presence_checks_database_and_files(monkeypatch, tmp_path):
    monkeypatch.setattr(song_service.config, "SONG_OUTPUT_DIR", tmp_path)
    database = Mock()
    database.query.return_value.filter.return_value.first.return_value = ("id",)
    assert (song_service._slug_exists(database, 'song') is True) and (song_service._slug_has_files('song') is False)
    (tmp_path / "song").mkdir()
    assert song_service._slug_has_files("song") is True


@pytest.mark.parametrize(
    ("tags", "expected"),
    [
        (object(), None),
        ({"title": ["", " Title "]}, "Title"),
        ({"title": (None, "Song")}, "Song"),
        ({"title": "   ", "artist": " Artist "}, "Artist"),
        ({"title": [None, " "], "artist": None}, None),
    ],
)
def test_first_audio_tag(tags, expected):
    assert song_service._first_audio_tag(tags, "title", "artist") == expected


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("", (None, "song")),
        ("Artist - Title (2).mp3", ("Artist", "Title")),
        ("Artist-Title-Part.mp3", ("Artist", "Title-Part")),
        ("123-Title.mp3", (None, "123-Title")),
        ("Title.mp3", (None, "Title")),
        ("Artist - Title (Sefon.Pro).mp3", ("Artist", "Title")),
    ],
)
def test_filename_identity(filename, expected):
    assert song_service.parse_filename_identity(filename) == expected


def test_artist_folder_and_slug_normalization():
    assert (song_service._clean_copy_suffix('Song (3)') == 'Song') and (song_service._normalize_artist_title('Нервы Всё, Что Вокруг', 'Нервы Моя Леди') == ('Нервы', 'Моя Леди')) and (song_service._folder_name('Artist', 'Bad:/Title', 'fallback') == 'Artist Bad Title') and (song_service._folder_name(None, '<>', 'fallback') == 'fallback') and (len(song_service._folder_name('A' * 200, 'Title', 'fallback')) == 180) and (song_service.slugify('Café Song!', 'fallback') == 'cafe-song') and (song_service.slugify('Песня', 'fallback') == 'fallback')


def test_source_identity_prefers_tags_then_filename_then_request(monkeypatch, tmp_path):
    mutagen = ModuleType("mutagen")
    mutagen.File = Mock(return_value={"title": ["Tagged"], "artist": ["Artist Tagged Album"]})
    monkeypatch.setitem(__import__("sys").modules, "mutagen", mutagen)
    assert song_service._read_source_identity(tmp_path / "x", "File - Name.mp3", "Request") == (
        "Artist",
        "Tagged",
    )
    mutagen.File.return_value = {
        "title": ["Нервы Моя Леди"],
        "artist": ["Нервы Всё, Что Вокруг"],
    }
    assert song_service._read_source_identity(tmp_path / "x", "Plain.mp3", "Request") == (
        "Нервы",
        "Моя Леди",
    )
    mutagen.File.return_value = None
    assert song_service._read_source_identity(tmp_path / "x", "File - Name.mp3", "Request") == (
        "File",
        "Name",
    )
    mutagen.File.side_effect = RuntimeError("broken tags")
    assert song_service._read_source_identity(tmp_path / "x", "Plain.mp3", " Request ") == (
        None,
        "Request",
    )


def test_unique_output_and_slug_increment_collisions(monkeypatch, tmp_path):
    monkeypatch.setattr(song_service.config, "SONG_OUTPUT_DIR", tmp_path)
    (tmp_path / "Artist Song").mkdir()
    (tmp_path / "Artist Song (2)").mkdir()
    assert song_service._unique_output_dir("Artist Song") == tmp_path / "Artist Song (3)"
    database = Mock()
    patch_attrs(monkeypatch, song_service, _slug_exists=Mock(side_effect=[True, False, False]), _slug_has_files=Mock(side_effect=[True, False]))
    assert song_service.make_unique_slug(database, "song") == "song-3"


def test_song_input_sanitizes_name_and_validates_extension():
    assert song_service._song_input("", "../Artist - Song.MP3") == (
        "Artist - Song",
        "Artist - Song.MP3",
        ".mp3",
    )
    assert song_service._song_input(
        "Title (Sefon.Pro)", "Artist - Title (Sefon.Pro).mp3"
    )[0] == "Title"
    raises(ValueError, lambda: song_service._song_input('Song', 'song.exe'), match='формат')
    raises(ValueError, lambda: song_service._song_input('Song', 'song'), match='расширения')


def test_create_song_persists_bytes_and_cleans_commit_failure(monkeypatch, tmp_path):
    patch_many(monkeypatch, (song_service.config, "SONG_OUTPUT_DIR", tmp_path), (song_service, "_slug_exists", Mock(return_value=False)))
    database = Mock()

    def commit(_db, current):
        current.id = "id"
        return current

    monkeypatch.setattr(song_service, "commit_refresh", commit)
    current = song_service.create_song(database, "", "Artist - Song.wav", b"audio")
    assert (current.artist == 'Artist' and current.title == 'Song') and (__import__('pathlib').Path(current.source_path).read_bytes() == b'audio')
    raises(ValueError, lambda: song_service.create_song(database, 'Song', 'song.wav', b''), match='empty')

    patch_attrs(monkeypatch, song_service, commit_refresh=Mock(side_effect=RuntimeError('database failed')))
    raises(RuntimeError, lambda: song_service.create_song(database, 'Custom', 'song.wav', b'audio'), match='database failed')
    assert not (tmp_path / "custom/source.wav").exists()


def test_duplicate_identity_is_unicode_and_case_insensitive_but_artist_specific():
    database = Mock()
    database.scalars.return_value = [SimpleNamespace(artist="Нервы", title="  МОЯ   ЛЕДИ ")]
    # Same artist+title (modulo unicode normalization/case/whitespace) matches.
    assert song_service._find_duplicate(database, "Нервы", "Моя леди") is database.scalars.return_value[0]
    # Same title but a DIFFERENT artist must NOT be treated as the same song.
    assert song_service._find_duplicate(database, "Other Artist", "Моя леди") is None
    # Neither side has a known artist: falls back to matching on title alone.
    database.scalars.return_value = [SimpleNamespace(artist=None, title="Home")]
    assert song_service._find_duplicate(database, None, "Home") is database.scalars.return_value[0]
    # A known artist should not silently collide with an untagged same-title entry.
    assert song_service._find_duplicate(database, "Artist A", "Home") is None


def test_create_song_from_streamed_path_moves_nonempty_source(monkeypatch, tmp_path):
    library = tmp_path / "library"
    patch_many(monkeypatch, (song_service.config, "SONG_OUTPUT_DIR", library), (song_service, "_slug_exists", Mock(return_value=False)))
    temporary, database = tmp_path / 'upload.flac', Mock()
    raises(ValueError, lambda: song_service.create_song_from_path(database, '', 'song.flac', temporary), match='empty')
    temporary.write_bytes(b"")
    raises(ValueError, lambda: song_service.create_song_from_path(database, '', 'song.flac', temporary), match='empty')
    temporary.write_bytes(b"audio")
    patch_attrs(monkeypatch, song_service, _read_source_identity=Mock(return_value=(None, 'Song')), commit_refresh=lambda _db, current: current)
    current = song_service.create_song_from_path(database, "", "song.flac", temporary)
    assert (not temporary.exists()) and (__import__('pathlib').Path(current.source_path).read_bytes() == b'audio')


def test_list_get_update_and_delete_song(monkeypatch, tmp_path):
    database = Mock()
    database.scalars.return_value = ["new", "old"]
    assert song_service.list_songs(database) == ["new", "old"]
    monkeypatch.setattr(song_service.repositories, "get_song", Mock(return_value="song"))
    assert song_service.get_song(database, "id") == "song"

    current, commit = SimpleNamespace(title='Old', key_override=None, tempo_override=None, note_range_min=40, note_range_max=80, key_user_edited=False, tempo_user_edited=False), Mock(side_effect=lambda _db, item: item)
    monkeypatch.setattr(song_service, "commit_refresh", commit)
    result = song_service.update_song(
        database,
        current,
        schemas.SongUpdate(title="New", key_override="C", tempo_override=120),
    )
    assert result.title == "New" and result.key_user_edited and result.tempo_user_edited
    raises(ValueError, lambda: song_service.update_song(database, current, schemas.SongUpdate(note_range_min=100)), match='note_range')

    commit.side_effect = RuntimeError("commit failed")
    raises(RuntimeError, lambda: song_service.update_song(database, current, schemas.SongUpdate(key_override=None)))
    assert current.key_override == "C" and current.key_user_edited is True

    library = tmp_path / "library"
    output = library / "song"
    source = output / "source.wav"
    monkeypatch.setattr(song_service.config, "SONG_OUTPUT_DIR", library)
    domain, delete = SimpleNamespace(id='song-id', output_dir=str(output), source_path=str(source), slug='song'), Mock()
    monkeypatch.setattr(song_service, "delete_with_files", delete)
    song_service.delete_song(database, domain)
    delete.assert_called_with(database, domain, (output.resolve(),))

    outside = library / "external.wav"
    domain.source_path = str(outside)
    song_service.delete_song(database, domain)
    delete.assert_called_with(database, domain, (output.resolve(), outside.resolve()))


def test_create_song_from_streamed_path_supports_cross_device_move(monkeypatch, tmp_path):
    library, temporary = tmp_path / 'library', tmp_path / 'upload.flac'
    temporary.write_bytes(b"audio")
    monkeypatch.setattr(song_service.config, "SONG_OUTPUT_DIR", library)
    patch_attrs(monkeypatch, song_service, _slug_exists=Mock(return_value=False), _read_source_identity=Mock(return_value=(None, 'Song')), commit_refresh=lambda _db, current: current)
    real_replace = Path.replace

    def cross_device_upload(self, target):
        if self == temporary:
            error = OSError(18, "cross-device link")
            error.winerror = 17
            raise error
        return real_replace(self, target)

    monkeypatch.setattr(Path, "replace", cross_device_upload)
    current = song_service.create_song_from_path(Mock(), "", "song.flac", temporary)
    assert (Path(current.source_path).read_bytes() == b'audio') and (not temporary.exists())


@pytest.mark.parametrize(
    ("payload", "suffix"),
    [
        (b"\xff\xd8\xffimage", ".jpg"),
        (b"\x89PNG\r\n\x1a\nimage", ".png"),
        (b"RIFFxxxxWEBPimage", ".webp"),
    ],
)
def test_extract_embedded_cover_persists_supported_artwork(monkeypatch, tmp_path, payload, suffix):
    mutagen = ModuleType("mutagen")
    mutagen.File = Mock(return_value=SimpleNamespace(pictures=[SimpleNamespace(data=payload)], tags=None))
    monkeypatch.setitem(__import__("sys").modules, "mutagen", mutagen)
    source = tmp_path / "song.flac"
    source.write_bytes(b"audio")
    cover = song_service.extract_embedded_cover(source, tmp_path)
    assert (cover == tmp_path / f'cover{suffix}') and (cover.read_bytes() == payload)


def test_extract_embedded_cover_ignores_invalid_or_unreadable_metadata(monkeypatch, tmp_path):
    mutagen = ModuleType("mutagen")
    mutagen.File = Mock(return_value=SimpleNamespace(pictures=[SimpleNamespace(data=b"not-an-image")], tags=None))
    monkeypatch.setitem(__import__("sys").modules, "mutagen", mutagen)
    source = tmp_path / "song.mp3"
    source.write_bytes(b"audio")
    assert song_service.extract_embedded_cover(source, tmp_path) is None
    mutagen.File.side_effect = RuntimeError("broken metadata")
    assert song_service.extract_embedded_cover(source, tmp_path) is None
