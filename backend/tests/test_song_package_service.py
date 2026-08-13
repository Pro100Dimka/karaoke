import contextlib
import json
import stat
import zipfile
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

import models
from app.services import song_package_service


def song(source, output):
    return models.Song(
        id="song-id",
        title="Song",
        artist="Artist",
        original_filename="song.wav",
        source_path=str(source),
        slug="artist-song",
        output_dir=str(output),
        status=models.SongStatus.DONE,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        updated_at=datetime(2026, 1, 1, tzinfo=UTC),
    )


def test_manifest_and_package_build_filter_private_artifacts(monkeypatch, tmp_path):
    output = tmp_path / "output"
    output.mkdir()
    source = output / "source.wav"
    source.write_bytes(b"source")
    (output / "music.json").write_text("{}", encoding="utf-8")
    (output / "pipeline.log").write_text("private", encoding="utf-8")
    (output / "take-private.wav").write_bytes(b"private")
    (output / "logs").mkdir()
    (output / "logs/x").write_text("private", encoding="utf-8")
    (output / "directory").mkdir()
    symlink = output / "link"
    with contextlib.suppress(OSError):
        symlink.symlink_to(tmp_path / "outside")
    current = song(source, output)
    monkeypatch.setattr(song_package_service.config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(song_package_service.config, "SONG_OUTPUT_DIR", tmp_path)
    package = song_package_service.build_package(current)
    try:
        with zipfile.ZipFile(package) as archive:
            assert set(archive.namelist()) == {
                "manifest.json",
                "source/source.wav",
                "output/music.json",
            }
            assert json.loads(archive.read("manifest.json"))["id"] == "song-id"
    finally:
        package.unlink()


def test_package_build_requires_complete_files_and_cleans_archive_failure(monkeypatch, tmp_path):
    output = tmp_path / "output"
    source = tmp_path / "missing.wav"
    monkeypatch.setattr(song_package_service.config, "SONG_OUTPUT_DIR", tmp_path)
    with pytest.raises(ValueError, match="incomplete"):
        song_package_service.build_package(song(source, output))
    output.mkdir()
    source.write_bytes(b"source")
    monkeypatch.setattr(song_package_service.config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(
        song_package_service.zipfile,
        "ZipFile",
        Mock(side_effect=OSError("zip failed")),
    )
    with pytest.raises(OSError, match="zip failed"):
        song_package_service.build_package(song(source, output))
    assert not list(tmp_path.glob("karaoke-song-*.zip"))


@pytest.mark.parametrize(
    "name",
    ["", "../escape", "/absolute", "C:/drive", "back\\slash", "nul\0name"],
)
def test_member_path_rejects_unsafe_names(name):
    with pytest.raises(ValueError, match="unsafe"):
        song_package_service._member_path(SimpleNamespace(filename=name))
    assert song_package_service._member_path(zipfile.ZipInfo("output/music.json")).as_posix() == (
        "output/music.json"
    )


def fake_member(name, *, size=1, compressed=1, mode=0, flags=0):
    member = zipfile.ZipInfo(name)
    member.file_size = size
    member.compress_size = compressed
    member.external_attr = mode << 16
    member.flag_bits = flags
    return member


def test_safe_members_enforces_limits_links_encryption_ratio_and_duplicates(monkeypatch):
    archive = Mock()
    monkeypatch.setattr(song_package_service, "MAX_PACKAGE_FILES", 1)
    archive.infolist.return_value = [fake_member("a"), fake_member("b")]
    with pytest.raises(ValueError, match="too many"):
        song_package_service._safe_members(archive)

    monkeypatch.setattr(song_package_service, "MAX_PACKAGE_FILES", 500)
    monkeypatch.setattr(song_package_service, "MAX_PACKAGE_BYTES", 1)
    archive.infolist.return_value = [fake_member("a", size=2)]
    with pytest.raises(ValueError, match="too large"):
        song_package_service._safe_members(archive)

    monkeypatch.setattr(song_package_service, "MAX_PACKAGE_BYTES", 2 * 1024**3)
    cases = [
        (fake_member("a", mode=stat.S_IFLNK), "symbolic"),
        (fake_member("a", flags=1), "Encrypted"),
        (fake_member("a", size=2 * 1024**2, compressed=1), "suspiciously"),
    ]
    for member, message in cases:
        archive.infolist.return_value = [member]
        with pytest.raises(ValueError, match=message):
            song_package_service._safe_members(archive)
    archive.infolist.return_value = [fake_member("a"), fake_member("a")]
    with pytest.raises(ValueError, match="duplicate"):
        song_package_service._safe_members(archive)
    archive.infolist.return_value = [fake_member("a")]
    assert song_package_service._safe_members(archive) == archive.infolist.return_value


def test_manifest_identity_and_source_validation(tmp_path):
    package = tmp_path / "package.zip"
    with zipfile.ZipFile(package, "w") as archive:
        archive.writestr("manifest.json", '{"id":"id","title":"Song"}')
        archive.writestr("source/song.wav", b"audio")
    with zipfile.ZipFile(package) as archive:
        manifest = song_package_service._read_manifest(archive)
        assert song_package_service._package_identity(manifest) == ("id", "Song")
        assert song_package_service._source_member(archive.infolist()).filename == "source/song.wav"

    for manifest in ({}, {"id": "id"}, {"title": "Song"}):
        with pytest.raises(ValueError, match="no song"):
            song_package_service._package_identity(manifest)
    with pytest.raises(ValueError, match="one source"):
        song_package_service._source_member([])
    with pytest.raises(ValueError, match="format"):
        song_package_service._source_member([fake_member("source/song.exe")])


def test_manifest_rejects_missing_invalid_and_non_object_json(tmp_path):
    package = tmp_path / "bad.zip"
    for payload in (None, b"invalid", b"[]", b"\xff"):
        with zipfile.ZipFile(package, "w") as archive:
            if payload is not None:
                archive.writestr("manifest.json", payload)
        with zipfile.ZipFile(package) as archive, pytest.raises(ValueError, match="manifest"):
            song_package_service._read_manifest(archive)


def test_copy_extract_and_song_model(monkeypatch, tmp_path):
    package = tmp_path / "package.zip"
    with zipfile.ZipFile(package, "w") as archive:
        archive.writestr("source/song.wav", b"source")
        archive.writestr("output/music.json", b"music")
        archive.writestr("output/", b"")
        archive.writestr("other/ignored", b"ignored")
    with zipfile.ZipFile(package) as archive:
        members = archive.infolist()
        song_package_service._copy_archive_member(archive, members[0], tmp_path / "copy.wav")
        song_package_service._extract_output(archive, members, tmp_path / "extract")
    assert (tmp_path / "copy.wav").read_bytes() == b"source"
    assert (tmp_path / "extract/music.json").read_bytes() == b"music"

    current = song_package_service._song_from_manifest(
        {"artist": "Artist", "show_lyrics": False},
        song_id="id",
        title="Song",
        slug="song",
        source_path=tmp_path / "source.wav",
        output_dir=tmp_path,
    )
    assert current.status == models.SongStatus.DONE
    assert current.show_lyrics is False and current.show_notes is True and current.optimized is True


def build_import_package(path):
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("manifest.json", '{"id":"id","title":"Song","slug":"Song"}')
        archive.writestr("source/song.wav", b"source")
        archive.writestr("output/music.json", b"{}")


def test_import_package_is_idempotent_atomic_and_recovers_failure(monkeypatch, tmp_path):
    package = tmp_path / "package.zip"
    build_import_package(package)
    database = Mock()
    existing = object()
    get = Mock(return_value=existing)
    monkeypatch.setattr(song_package_service.song_service, "get_song", get)
    assert song_package_service.import_package(database, package) is existing

    library = tmp_path / "library"
    cache = tmp_path / "cache"
    library.mkdir()
    cache.mkdir()
    monkeypatch.setattr(song_package_service.config, "SONG_OUTPUT_DIR", library)
    monkeypatch.setattr(song_package_service.config, "CACHE_DIR", cache)
    get.side_effect = [None, None]
    monkeypatch.setattr(
        song_package_service.song_service, "make_unique_slug", Mock(return_value="song")
    )
    monkeypatch.setattr(song_package_service, "commit_refresh", lambda _db, current: current)
    imported = song_package_service.import_package(database, package)
    assert imported.id == "id"
    assert (library / "song/source.wav").read_bytes() == b"source"
    assert (library / "song/music.json").is_file()

    package2 = tmp_path / "package2.zip"
    build_import_package(package2)
    get.side_effect = [None, None]
    monkeypatch.setattr(
        song_package_service,
        "commit_refresh",
        Mock(side_effect=RuntimeError("database failed")),
    )
    monkeypatch.setattr(
        song_package_service.song_service, "make_unique_slug", Mock(return_value="bad")
    )
    with pytest.raises(RuntimeError, match="database failed"):
        song_package_service.import_package(database, package2)
    database.rollback.assert_called()
    assert not (library / "bad").exists()


def test_import_package_rechecks_identity_inside_lock(monkeypatch, tmp_path):
    package = tmp_path / "package.zip"
    build_import_package(package)
    database = Mock()
    winner = object()
    monkeypatch.setattr(
        song_package_service.song_service,
        "get_song",
        Mock(side_effect=[None, winner]),
    )
    assert song_package_service.import_package(database, package) is winner
