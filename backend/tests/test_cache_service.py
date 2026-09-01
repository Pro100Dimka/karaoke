from types import SimpleNamespace
from unittest.mock import Mock

import pytest

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
    cache_service.invalidate_cache_size()  # a prior test's cached total must not leak in
    assert cache_service.cache_size()["total_bytes"] == 6
    monkeypatch.setattr(cache_service.shutil, "disk_usage", Mock(return_value=SimpleNamespace(free=1024, total=2048)))
    assert cache_service.free_space()["free_human"] == "1.0 KB"


def test_cache_size_is_cached_between_calls_until_invalidated(monkeypatch, tmp_path):
    songs, cache, database = tmp_path / "songs", tmp_path / "cache", tmp_path / "app.db"
    songs.mkdir()
    cache.mkdir()
    (songs / "song").write_bytes(b"123")
    patch_attrs(monkeypatch, cache_service.config, SONG_OUTPUT_DIR=songs, CACHE_DIR=cache, DB_PATH=database)
    cache_service.invalidate_cache_size()

    walk = Mock(wraps=cache_service._dir_size_bytes)
    monkeypatch.setattr(cache_service, "_dir_size_bytes", walk)
    first, second = cache_service.cache_size(), cache_service.cache_size()
    # 2 walks (songs dir + cache dir) for the first call; the second call must
    # reuse the cached result instead of walking the library again.
    assert first == second and walk.call_count == 2

    (songs / "song").write_bytes(b"12345")
    assert cache_service.cache_size()["total_bytes"] == first["total_bytes"]  # still stale within the TTL

    cache_service.invalidate_cache_size()
    assert cache_service.cache_size()["total_bytes"] == 5


def test_temp_cleanup_preserves_runtime_contract(monkeypatch, tmp_path):
    root, song = tmp_path / "songs", tmp_path / "songs/song"
    (song / "tmp").mkdir(parents=True)
    (song / "tmp/data").write_bytes(b"1234")
    (song / "lyricsSync.json").write_text("{}", encoding="utf-8")
    monkeypatch.setattr(cache_service.config, "SONG_OUTPUT_DIR", root)
    invalidate = Mock()
    monkeypatch.setattr(cache_service, "invalidate_cache_size", invalidate)
    assert cache_service.clear_temp_files() == 4
    assert (song / "lyricsSync.json").exists()
    invalidate.assert_called_once_with()


def test_optimize_marks_song_and_removes_intermediates(monkeypatch, tmp_path):
    current = make_song(tmp_path, output_dir=str(tmp_path))
    database, _ = mock_song_lookup(monkeypatch, cache_service, current)
    (tmp_path / ".ai-cache").mkdir()
    (tmp_path / ".ai-cache/data").write_bytes(b"123")
    patch_attrs(monkeypatch, cache_service.song_service, resolve_output_dir=Mock(return_value=tmp_path))
    commit, invalidate, invalidate_size = Mock(), Mock(), Mock()
    monkeypatch.setattr(cache_service, "commit", commit)
    monkeypatch.setattr(cache_service.revision_cache, "invalidate", invalidate)
    monkeypatch.setattr(cache_service, "invalidate_cache_size", invalidate_size)
    result = cache_service.optimize_song_files(current.id)
    assert result["freed_bytes"] == 3 and current.optimized is True
    commit.assert_called_once_with(database)
    invalidate.assert_called_once_with(current)
    invalidate_size.assert_called_once_with()
    database.close.assert_called_once_with()


def test_optimize_missing_song_is_noop(monkeypatch):
    database, _ = mock_song_lookup(monkeypatch, cache_service)
    assert cache_service.optimize_song_files("missing")["freed_bytes"] == 0
    database.close.assert_called_once_with()


def test_interrupted_optimization_is_retryable_and_never_commits_early(monkeypatch, tmp_path):
    current = make_song(tmp_path, output_dir=str(tmp_path), optimized=False)
    database, _ = mock_song_lookup(monkeypatch, cache_service, current)
    for name in ("tmp", ".ai-cache"):
        (tmp_path / name).mkdir()
        (tmp_path / name / "data").write_bytes(b"123")
    patch_attrs(
        monkeypatch,
        cache_service.song_service,
        resolve_output_dir=Mock(return_value=tmp_path),
    )
    commit = Mock()
    monkeypatch.setattr(cache_service, "commit", commit)
    original_rmtree = cache_service.shutil.rmtree

    def fail_second_directory(path):
        if path.name == ".ai-cache":
            raise OSError("injected deletion failure")
        original_rmtree(path)

    monkeypatch.setattr(cache_service.shutil, "rmtree", fail_second_directory)
    with pytest.raises(OSError, match="injected deletion failure"):
        cache_service.optimize_song_files(current.id)
    assert current.optimized is False
    commit.assert_not_called()
    assert not (tmp_path / "tmp").exists()
    assert (tmp_path / ".ai-cache").exists()

    monkeypatch.setattr(cache_service.shutil, "rmtree", original_rmtree)
    result = cache_service.optimize_song_files(current.id)
    assert result["freed_bytes"] == 3
    assert current.optimized is True
    assert not (tmp_path / ".ai-cache").exists()
    commit.assert_called_once_with(database)
