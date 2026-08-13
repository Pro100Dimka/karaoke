from types import SimpleNamespace
from unittest.mock import Mock

import pytest

import models
from app.services import cache_service


def test_encoders_build_expected_ffmpeg_commands(monkeypatch, tmp_path):
    run = Mock()
    monkeypatch.setattr(cache_service.subprocess, "run", run)
    monkeypatch.setattr(cache_service.config, "FFMPEG_EXE", "ffmpeg-custom")
    wav = tmp_path / "source.wav"
    cache_service._encode_mp3(wav, tmp_path / "target.mp3")
    cache_service._encode_flac(wav, tmp_path / "target.flac")
    assert run.call_count == 2
    assert "libmp3lame" in run.call_args_list[0].args[0]
    assert "flac" in run.call_args_list[1].args[0]
    assert all(call.kwargs["check"] for call in run.call_args_list)


@pytest.mark.parametrize(
    ("size", "expected"),
    [(0, "0.0 B"), (1024, "1.0 KB"), (1024**2, "1.0 MB"), (1024**6, "1024.0 PB")],
)
def test_directory_size_and_human_format(tmp_path, size, expected):
    assert cache_service._human(size) == expected
    missing = tmp_path / "missing"
    assert cache_service._dir_size_bytes(missing) == 0
    directory = tmp_path / "files"
    directory.mkdir()
    (directory / "a").write_bytes(b"123")
    nested = directory / "nested"
    nested.mkdir()
    (nested / "b").write_bytes(b"45")
    assert cache_service._dir_size_bytes(directory) == 5


def test_cache_and_free_space_reports(monkeypatch, tmp_path):
    songs = tmp_path / "songs"
    cache = tmp_path / "cache"
    database = tmp_path / "app.db"
    songs.mkdir()
    cache.mkdir()
    (songs / "song").write_bytes(b"123")
    (cache / "temp").write_bytes(b"12")
    database.write_bytes(b"1")
    monkeypatch.setattr(cache_service.config, "SONG_OUTPUT_DIR", songs)
    monkeypatch.setattr(cache_service.config, "CACHE_DIR", cache)
    monkeypatch.setattr(cache_service.config, "DB_PATH", database)
    assert cache_service.cache_size()["total_bytes"] == 6

    monkeypatch.setattr(
        cache_service.shutil,
        "disk_usage",
        Mock(return_value=SimpleNamespace(free=1024, total=2048)),
    )
    assert cache_service.free_space() == {
        "free_bytes": 1024,
        "free_human": "1.0 KB",
        "total_bytes": 2048,
        "total_human": "2.0 KB",
    }


def test_temp_cleanup_ignores_files_and_removes_known_directories(monkeypatch, tmp_path):
    root = tmp_path / "songs"
    monkeypatch.setattr(cache_service.config, "SONG_OUTPUT_DIR", root)
    assert cache_service.clear_temp_files() == 0
    root.mkdir()
    (root / "ignore.txt").write_text("x", encoding="utf-8")
    song = root / "song"
    (song / "tmp").mkdir(parents=True)
    (song / "tmp/data").write_bytes(b"1234")
    (song / "__pycache__").mkdir()
    (song / "__pycache__/cache").write_bytes(b"12")
    assert cache_service.clear_temp_files() == 6
    assert not (song / "tmp").exists() and not (song / "__pycache__").exists()


def test_remove_intermediate_directories_records_actions(tmp_path):
    actions = []
    out = tmp_path / "song"
    (out / "tmp").mkdir(parents=True)
    (out / "tmp/data").write_bytes(b"123")
    assert cache_service._remove_intermediate_directories(out, actions) == 3
    assert actions and "tmp/" in actions[0]


def test_heavy_wav_conversion_preserves_failed_sources(monkeypatch, tmp_path):
    song_wav = tmp_path / "song.wav"
    song_wav.write_bytes(b"1234567890")
    separated = tmp_path / "separated"
    separated.mkdir()
    vocals = separated / "vocals.wav"
    instrumental = separated / "instrumental.wav"
    vocals.write_bytes(b"12345678")
    instrumental.write_bytes(b"123456")

    def encode_mp3(_source, target):
        target.write_bytes(b"12")

    def encode_flac(source, target):
        if source == instrumental:
            raise RuntimeError("codec failed")
        target.write_bytes(b"123")

    monkeypatch.setattr(cache_service, "_encode_mp3", encode_mp3)
    monkeypatch.setattr(cache_service, "_encode_flac", encode_flac)
    actions = []
    assert cache_service._convert_heavy_wavs(tmp_path, actions) == 13
    assert not song_wav.exists() and not vocals.exists()
    assert instrumental.exists()
    assert len(actions) == 2

    failed = tmp_path / "song.wav"
    failed.write_bytes(b"audio")
    monkeypatch.setattr(
        cache_service,
        "_encode_mp3",
        Mock(side_effect=RuntimeError("encoder failed")),
    )
    assert cache_service._convert_heavy_wavs(tmp_path, []) == 0
    assert failed.exists()
    failed.unlink()
    instrumental.unlink()
    assert cache_service._convert_heavy_wavs(tmp_path, []) == 0


def song(tmp_path, **changes):
    values = {
        "id": "song",
        "title": "Song",
        "original_filename": "song.wav",
        "source_path": str(tmp_path / "source.wav"),
        "slug": "song",
        "output_dir": str(tmp_path),
    }
    values.update(changes)
    return models.Song(**values)


def test_optimize_song_handles_missing_and_complete_song(monkeypatch, tmp_path):
    database = Mock()
    monkeypatch.setattr(cache_service, "SessionLocal", Mock(return_value=database))
    monkeypatch.setattr(cache_service.repositories, "get_song", Mock(return_value=None))
    assert cache_service.optimize_song_files("missing") == {
        "song_id": "missing",
        "freed_bytes": 0,
        "freed_human": "0.0 B",
        "actions": [],
    }
    database.close.assert_called_once_with()

    database.reset_mock()
    out = tmp_path / "song"
    out.mkdir()
    normalized = out / "song.mp3"
    normalized.write_bytes(b"normalized")
    duplicate = tmp_path / "source.wav"
    duplicate.write_bytes(b"12345")
    current = song(tmp_path, source_path=str(duplicate), output_dir=str(out))
    cache_service.repositories.get_song.return_value = current
    monkeypatch.setattr(cache_service.song_service, "resolve_output_dir", Mock(return_value=out))
    monkeypatch.setattr(
        cache_service.song_service,
        "resolve_source_path",
        Mock(return_value=duplicate),
    )
    monkeypatch.setattr(cache_service, "_convert_heavy_wavs", Mock(return_value=7))
    monkeypatch.setattr(cache_service, "_remove_intermediate_directories", Mock(return_value=3))
    commit = Mock()
    monkeypatch.setattr(cache_service, "commit", commit)

    result = cache_service.optimize_song_files("song")

    assert result["freed_bytes"] == 15
    assert current.optimized is True and current.source_path == str(normalized)
    assert not duplicate.exists()
    commit.assert_called_once_with(database)
    database.close.assert_called_once_with()


def test_optimize_song_closes_database_when_service_fails(monkeypatch, tmp_path):
    database = Mock()
    monkeypatch.setattr(cache_service, "SessionLocal", Mock(return_value=database))
    monkeypatch.setattr(cache_service.repositories, "get_song", Mock(return_value=song(tmp_path)))
    monkeypatch.setattr(
        cache_service.song_service,
        "resolve_output_dir",
        Mock(side_effect=RuntimeError("invalid path")),
    )
    with pytest.raises(RuntimeError, match="invalid path"):
        cache_service.optimize_song_files("song")
    database.close.assert_called_once_with()
