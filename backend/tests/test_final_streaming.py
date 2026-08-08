from __future__ import annotations

import stat
import zipfile
from pathlib import Path

import pytest

import config
from app.services import song_package_service, song_service, storage_migration


def test_storage_migration_recovers_source_after_interrupted_legacy_move(tmp_path):
    song_dir = tmp_path / "song"
    song_dir.mkdir()
    retained = song_dir / "song.wav"
    retained.write_bytes(b"audio")

    assert storage_migration._existing_source(song_dir) == retained


class FakeDb:
    def __init__(self, *, fail_commit: bool = False):
        self.fail_commit = fail_commit
        self.added = None
        self.rolled_back = False
        self.refreshed = False

    def query(self, _column):
        class Query:
            def filter(self, *_args):
                return self

            def first(self):
                return None

        return Query()

    def add(self, instance):
        self.added = instance

    def commit(self):
        if self.fail_commit:
            raise RuntimeError("database locked")

    def rollback(self):
        self.rolled_back = True

    def refresh(self, _instance):
        self.refreshed = True


def _configure_library(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(config, "SONG_OUTPUT_DIR", tmp_path / "karaoke_songs")


def test_create_song_from_path_moves_streamed_upload(monkeypatch, tmp_path):
    _configure_library(monkeypatch, tmp_path)
    temporary = config.SONG_OUTPUT_DIR / ".upload.tmp"
    temporary.parent.mkdir(parents=True)
    temporary.write_bytes(b"audio")
    db = FakeDb()

    song = song_service.create_song_from_path(db, "  Test Song  ", "folder/input.WAV", temporary)

    destination = config.SONG_OUTPUT_DIR / "test-song" / "source.wav"
    assert song.title == "Test Song"
    assert song.original_filename == "input.WAV"
    assert Path(song.source_path) == destination
    assert destination.read_bytes() == b"audio"
    assert not temporary.exists()
    assert db.refreshed is True


def test_create_song_from_path_removes_moved_file_when_commit_fails(monkeypatch, tmp_path):
    _configure_library(monkeypatch, tmp_path)
    temporary = config.SONG_OUTPUT_DIR / ".upload.tmp"
    temporary.parent.mkdir(parents=True)
    temporary.write_bytes(b"audio")
    db = FakeDb(fail_commit=True)

    with pytest.raises(RuntimeError, match="database locked"):
        song_service.create_song_from_path(db, "Test", "input.wav", temporary)

    assert not temporary.exists()
    assert not (config.SONG_OUTPUT_DIR / "test" / "source.wav").exists()
    assert db.rolled_back is True


def test_create_song_from_path_rejects_empty_file(monkeypatch, tmp_path):
    _configure_library(monkeypatch, tmp_path)
    temporary = config.SONG_OUTPUT_DIR / ".upload.tmp"
    temporary.parent.mkdir(parents=True)
    temporary.touch()

    with pytest.raises(ValueError, match="empty"):
        song_service.create_song_from_path(FakeDb(), "Test", "input.wav", temporary)


def test_safe_members_rejects_symbolic_links(tmp_path):
    package = tmp_path / "song.zip"
    with zipfile.ZipFile(package, "w") as archive:
        info = zipfile.ZipInfo("output/link")
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(info, "../../secret")

    with zipfile.ZipFile(package) as archive, pytest.raises(ValueError, match="symbolic link"):
        song_package_service._safe_members(archive)
