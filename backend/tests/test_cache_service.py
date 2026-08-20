from types import SimpleNamespace
from unittest.mock import Mock

from app.services import cache_service
from tests._shared import make_song, mock_song_lookup, patch_attrs


def test_directory_size_and_human_format(tmp_path):
    directory = tmp_path / "files"
    (directory / "nested").mkdir(parents=True)
    (directory / "a").write_bytes(b"123")
    (directory / "nested/b").write_bytes(b"45")
    assert cache_service._dir_size_bytes(directory) == 5
    assert cache_service._human(1024) == "1.0 KB"


def test_cache_and_free_space_reports(monkeypatch, tmp_path):
    songs, cache, database = tmp_path / "songs", tmp_path / "cache", tmp_path / "app.db"
    songs.mkdir()
    cache.mkdir()
    (songs / "song").write_bytes(b"123")
    (cache / "temp").write_bytes(b"12")
    database.write_bytes(b"1")
    patch_attrs(monkeypatch, cache_service.config, SONG_OUTPUT_DIR=songs, CACHE_DIR=cache, DB_PATH=database)
    assert cache_service.cache_size()["total_bytes"] == 6
    monkeypatch.setattr(cache_service.shutil, "disk_usage", Mock(return_value=SimpleNamespace(free=1024, total=2048)))
    assert cache_service.free_space()["free_human"] == "1.0 KB"


def test_temp_cleanup_preserves_runtime_contract(monkeypatch, tmp_path):
    root, song = tmp_path / "songs", tmp_path / "songs/song"
    (song / "tmp").mkdir(parents=True)
    (song / "tmp/data").write_bytes(b"1234")
    (song / "lyricsSync.json").write_text("{}", encoding="utf-8")
    monkeypatch.setattr(cache_service.config, "SONG_OUTPUT_DIR", root)
    assert cache_service.clear_temp_files() == 4
    assert (song / "lyricsSync.json").exists()


def test_optimize_marks_song_and_removes_intermediates(monkeypatch, tmp_path):
    current = make_song(tmp_path, output_dir=str(tmp_path))
    database, _ = mock_song_lookup(monkeypatch, cache_service, current)
    (tmp_path / ".ai-cache").mkdir()
    (tmp_path / ".ai-cache/data").write_bytes(b"123")
    patch_attrs(monkeypatch, cache_service.song_service, resolve_output_dir=Mock(return_value=tmp_path))
    commit, invalidate = Mock(), Mock()
    monkeypatch.setattr(cache_service, "commit", commit)
    monkeypatch.setattr(cache_service.revision_cache, "invalidate", invalidate)
    result = cache_service.optimize_song_files(current.id)
    assert result["freed_bytes"] == 3 and current.optimized is True
    commit.assert_called_once_with(database)
    invalidate.assert_called_once_with(current)
    database.close.assert_called_once_with()


def test_optimize_missing_song_is_noop(monkeypatch):
    database, _ = mock_song_lookup(monkeypatch, cache_service)
    assert cache_service.optimize_song_files("missing")["freed_bytes"] == 0
    database.close.assert_called_once_with()
