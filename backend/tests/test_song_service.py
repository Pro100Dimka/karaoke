from types import ModuleType, SimpleNamespace
from unittest.mock import Mock

import pytest

import models
import schemas
from app.services import song_service


def test_library_lock_and_owned_path_validation(monkeypatch, tmp_path):
    root = tmp_path / "library"
    root.mkdir()
    monkeypatch.setattr(song_service.config, "SONG_OUTPUT_DIR", root)
    with song_service.library_write_lock():
        pass
    assert song_service._ensure_path_within(root, root) == root.resolve()
    nested = root / "song/source.wav"
    assert song_service._ensure_path_within(nested, root) == nested.resolve()
    with pytest.raises(ValueError, match="outside"):
        song_service._ensure_path_within(tmp_path / "outside", root)

    current = models.Song(
        id="song",
        title="Song",
        original_filename="song.wav",
        source_path=str(nested),
        slug="song",
        output_dir=None,
    )
    assert song_service.resolve_source_path(current) == nested.resolve()
    assert song_service.resolve_output_dir(current) == (root / "song").resolve()


def test_slug_presence_checks_database_and_files(monkeypatch, tmp_path):
    monkeypatch.setattr(song_service.config, "SONG_OUTPUT_DIR", tmp_path)
    database = Mock()
    database.query.return_value.filter.return_value.first.return_value = ("id",)
    assert song_service._slug_exists(database, "song") is True
    assert song_service._slug_has_files("song") is False
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
    ],
)
def test_filename_identity(filename, expected):
    assert song_service.parse_filename_identity(filename) == expected


def test_artist_folder_and_slug_normalization():
    assert song_service._clean_copy_suffix("Song (3)") == "Song"
    assert song_service._clean_artist_tag(None, "Song") is None
    assert song_service._clean_artist_tag("Artist Song Single [2024]", "Song") == "Artist"
    assert song_service._folder_name("Artist", "Bad:/Title", "fallback") == "Artist Bad Title"
    assert song_service._folder_name(None, "<>", "fallback") == "fallback"
    assert len(song_service._folder_name("A" * 200, "Title", "fallback")) == 180
    assert song_service.slugify("Café Song!", "fallback") == "cafe-song"
    assert song_service.slugify("Песня", "fallback") == "fallback"


def test_source_identity_prefers_tags_then_filename_then_request(monkeypatch, tmp_path):
    mutagen = ModuleType("mutagen")
    mutagen.File = Mock(return_value={"title": ["Tagged"], "artist": ["Artist Tagged Album"]})
    monkeypatch.setitem(__import__("sys").modules, "mutagen", mutagen)
    assert song_service._read_source_identity(tmp_path / "x", "File - Name.mp3", "Request") == (
        "Artist",
        "Tagged",
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
    monkeypatch.setattr(song_service, "_slug_exists", Mock(side_effect=[True, False, False]))
    monkeypatch.setattr(song_service, "_slug_has_files", Mock(side_effect=[True, False]))
    assert song_service.make_unique_slug(database, "song") == "song-3"


def test_song_input_sanitizes_name_and_validates_extension():
    assert song_service._song_input("", "../Artist - Song.MP3") == (
        "Artist - Song",
        "Artist - Song.MP3",
        ".mp3",
    )
    with pytest.raises(ValueError, match="формат"):
        song_service._song_input("Song", "song.exe")
    with pytest.raises(ValueError, match="расширения"):
        song_service._song_input("Song", "song")


def test_create_song_persists_bytes_and_cleans_commit_failure(monkeypatch, tmp_path):
    monkeypatch.setattr(song_service.config, "SONG_OUTPUT_DIR", tmp_path)
    monkeypatch.setattr(song_service, "_slug_exists", Mock(return_value=False))
    database = Mock()

    def commit(_db, current):
        current.id = "id"
        return current

    monkeypatch.setattr(song_service, "commit_refresh", commit)
    current = song_service.create_song(database, "", "Artist - Song.wav", b"audio")
    assert current.artist == "Artist" and current.title == "Song"
    assert __import__("pathlib").Path(current.source_path).read_bytes() == b"audio"
    with pytest.raises(ValueError, match="empty"):
        song_service.create_song(database, "Song", "song.wav", b"")

    monkeypatch.setattr(
        song_service,
        "commit_refresh",
        Mock(side_effect=RuntimeError("database failed")),
    )
    with pytest.raises(RuntimeError, match="database failed"):
        song_service.create_song(database, "Custom", "song.wav", b"audio")
    assert not (tmp_path / "custom/source.wav").exists()


def test_create_song_from_streamed_path_moves_nonempty_source(monkeypatch, tmp_path):
    library = tmp_path / "library"
    monkeypatch.setattr(song_service.config, "SONG_OUTPUT_DIR", library)
    monkeypatch.setattr(song_service, "_slug_exists", Mock(return_value=False))
    temporary = tmp_path / "upload.flac"
    database = Mock()
    with pytest.raises(ValueError, match="empty"):
        song_service.create_song_from_path(database, "", "song.flac", temporary)
    temporary.write_bytes(b"")
    with pytest.raises(ValueError, match="empty"):
        song_service.create_song_from_path(database, "", "song.flac", temporary)
    temporary.write_bytes(b"audio")
    monkeypatch.setattr(song_service, "_read_source_identity", Mock(return_value=(None, "Song")))
    monkeypatch.setattr(song_service, "commit_refresh", lambda _db, current: current)
    current = song_service.create_song_from_path(database, "", "song.flac", temporary)
    assert not temporary.exists()
    assert __import__("pathlib").Path(current.source_path).read_bytes() == b"audio"


def test_list_get_update_and_delete_song(monkeypatch, tmp_path):
    database = Mock()
    database.scalars.return_value = ["new", "old"]
    assert song_service.list_songs(database) == ["new", "old"]
    monkeypatch.setattr(song_service.repositories, "get_song", Mock(return_value="song"))
    assert song_service.get_song(database, "id") == "song"

    current = SimpleNamespace(
        title="Old",
        key_override=None,
        tempo_override=None,
        note_range_min=40,
        note_range_max=80,
        key_user_edited=False,
        tempo_user_edited=False,
    )
    commit = Mock(side_effect=lambda _db, item: item)
    monkeypatch.setattr(song_service, "commit_refresh", commit)
    result = song_service.update_song(
        database,
        current,
        schemas.SongUpdate(title="New", key_override="C", tempo_override=120),
    )
    assert result.title == "New" and result.key_user_edited and result.tempo_user_edited
    with pytest.raises(ValueError, match="note_range"):
        song_service.update_song(
            database,
            current,
            schemas.SongUpdate(note_range_min=100),
        )

    commit.side_effect = RuntimeError("commit failed")
    with pytest.raises(RuntimeError):
        song_service.update_song(database, current, schemas.SongUpdate(key_override=None))
    assert current.key_override == "C" and current.key_user_edited is True

    library = tmp_path / "library"
    output = library / "song"
    source = output / "source.wav"
    monkeypatch.setattr(song_service.config, "SONG_OUTPUT_DIR", library)
    domain = SimpleNamespace(output_dir=str(output), source_path=str(source), slug="song")
    delete = Mock()
    monkeypatch.setattr(song_service, "delete_with_files", delete)
    song_service.delete_song(database, domain)
    delete.assert_called_with(database, domain, (output.resolve(),))

    outside = library / "external.wav"
    domain.source_path = str(outside)
    song_service.delete_song(database, domain)
    delete.assert_called_with(database, domain, (output.resolve(), outside.resolve()))
