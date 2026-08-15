from pathlib import Path
from unittest.mock import Mock

import pytest

import models
from app.services import storage_migration


def song(tmp_path, **changes):
    values = {
        "id": "song",
        "title": "Song",
        "original_filename": "song.wav",
        "source_path": str(tmp_path / "source.wav"),
        "slug": "song",
        "output_dir": None,
    }
    values.update(changes)
    return models.Song(**values)


def test_existing_source_and_legacy_output_resolution(monkeypatch, tmp_path):
    target = tmp_path / "target"
    target.mkdir()
    assert storage_migration._existing_source(target) is None
    source = target / "source.flac"
    source.write_bytes(b"audio")
    assert storage_migration._existing_source(target) == source
    normalized = target / "song.mp3"
    normalized.write_bytes(b"normalized")
    assert storage_migration._existing_source(target) == normalized

    monkeypatch.setattr(storage_migration.config, "BASE_DIR", tmp_path)
    current = song(tmp_path)
    assert storage_migration._legacy_output(current) == (tmp_path / "Song/song").resolve()
    current.output_dir = str(target)
    assert storage_migration._legacy_output(current) == target.resolve()


def run_migration(monkeypatch, tmp_path, songs):
    database = Mock()
    database.query.return_value.all.return_value = songs
    monkeypatch.setattr(storage_migration, "SessionLocal", Mock(return_value=database))
    commit = Mock()
    monkeypatch.setattr(storage_migration, "commit", commit)
    monkeypatch.setattr(storage_migration.config, "BASE_DIR", tmp_path / "backend")
    monkeypatch.setattr(storage_migration.config, "SONG_OUTPUT_DIR", tmp_path / "library")
    storage_migration.migrate_legacy_song_storage()
    commit.assert_called_once_with(database)
    database.close.assert_called_once_with()
    return database


def test_migration_moves_legacy_directory_and_removes_duplicate_source(monkeypatch, tmp_path):
    legacy = tmp_path / "legacy"
    legacy.mkdir()
    (legacy / "song.mp3").write_bytes(b"normalized")
    original = tmp_path / "original.wav"
    original.write_bytes(b"duplicate")
    current = song(tmp_path, source_path=str(original), output_dir=str(legacy))

    run_migration(monkeypatch, tmp_path, [current])

    target = tmp_path / "library/song"
    assert current.output_dir == str(target.resolve())
    assert current.source_path == str(target / "song.mp3")
    assert not original.exists() and not legacy.exists()


def test_migration_moves_external_source_and_recovers_missing_path(monkeypatch, tmp_path):
    external = tmp_path / "track.FLAC"
    external.write_bytes(b"audio")
    first = song(tmp_path, source_path=str(external), slug="first", id="first")
    missing = song(
        tmp_path,
        source_path=str(tmp_path / "missing.wav"),
        slug="second",
        id="second",
        output_dir=str(tmp_path / "existing"),
    )
    existing = tmp_path / "existing"
    existing.mkdir()
    retained = existing / "source.wav"
    retained.write_bytes(b"retained")

    run_migration(monkeypatch, tmp_path, [first, missing])

    assert first.source_path == str(tmp_path / "library/first/source.flac")
    assert Path(first.source_path).read_bytes() == b"audio"
    assert missing.source_path == str((tmp_path / "library/second/source.wav").resolve())


def test_migration_keeps_current_human_readable_library_directory(monkeypatch, tmp_path):
    current_output = tmp_path / "library" / "Artist Song"
    current_output.mkdir(parents=True)
    source = current_output / "song.mp3"
    source.write_bytes(b"audio")
    current = song(
        tmp_path,
        source_path=str(source),
        output_dir=str(current_output),
        slug="song",
    )

    run_migration(monkeypatch, tmp_path, [current])

    assert current.output_dir == str(current_output.resolve())
    assert current.source_path == str(source)
    assert current_output.is_dir()
    assert not (tmp_path / "library" / "song").exists()


def test_migration_rewrites_source_inside_already_moved_output(monkeypatch, tmp_path):
    previous = tmp_path / "old/song"
    previous.mkdir(parents=True)
    nested = previous / "nested/source.wav"
    nested.parent.mkdir()
    nested.write_bytes(b"audio")
    target = tmp_path / "library/song"
    target.parent.mkdir()
    previous.replace(target)
    current = song(
        tmp_path, source_path=str(previous / "nested/source.wav"), output_dir=str(previous)
    )

    run_migration(monkeypatch, tmp_path, [current])

    assert current.source_path == str(target.resolve() / "nested/source.wav")


def test_migration_rolls_back_and_closes_database_on_failure(monkeypatch, tmp_path):
    database = Mock()
    database.query.side_effect = RuntimeError("database failed")
    monkeypatch.setattr(storage_migration, "SessionLocal", Mock(return_value=database))
    with pytest.raises(RuntimeError, match="database failed"):
        storage_migration.migrate_legacy_song_storage()
    database.rollback.assert_called_once_with()
    database.close.assert_called_once_with()


def test_migration_falls_back_to_cross_device_move(monkeypatch, tmp_path):
    legacy = tmp_path / "legacy"
    legacy.mkdir()
    (legacy / "song.mp3").write_bytes(b"audio")
    current = song(tmp_path, source_path=str(legacy / "song.mp3"), output_dir=str(legacy))
    real_replace = Path.replace

    def cross_device_once(self, target):
        if self == legacy:
            error = OSError(18, "cross-device link")
            error.winerror = 17
            raise error
        return real_replace(self, target)

    monkeypatch.setattr(Path, "replace", cross_device_once)
    run_migration(monkeypatch, tmp_path, [current])

    target = tmp_path / "library/song"
    assert target.is_dir()
    assert (target / "song.mp3").read_bytes() == b"audio"
    assert not legacy.exists()
