from tests._shared import mock_song_lookup, patch_attrs, make_song, raises, patch_many

from types import SimpleNamespace
from unittest.mock import Mock

import pytest

import models
from app.services import cache_service


def test_encoders_build_expected_ffmpeg_commands(monkeypatch, tmp_path):
    run = Mock()
    patch_many(monkeypatch, (cache_service.subprocess, "run", run), (cache_service.config, "FFMPEG_EXE", "ffmpeg-custom"))
    wav = tmp_path / "source.wav"
    cache_service._encode_mp3(wav, tmp_path / "target.mp3")
    cache_service._encode_flac(wav, tmp_path / "target.flac")
    assert (run.call_count == 2) and ('libmp3lame' in run.call_args_list[0].args[0]) and ('flac' in run.call_args_list[1].args[0]) and (all((call.kwargs['check'] for call in run.call_args_list)))


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
    songs, cache, database = tmp_path / 'songs', tmp_path / 'cache', tmp_path / 'app.db'
    songs.mkdir()
    cache.mkdir()
    (songs / "song").write_bytes(b"123")
    (cache / "temp").write_bytes(b"12")
    database.write_bytes(b"1")
    patch_attrs(monkeypatch, cache_service.config, SONG_OUTPUT_DIR=songs, CACHE_DIR=cache, DB_PATH=database)
    assert cache_service.cache_size()["total_bytes"] == 6

    patch_attrs(monkeypatch, cache_service.shutil, disk_usage=Mock(return_value=SimpleNamespace(free=1024, total=2048)))
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
    assert (cache_service.clear_temp_files() == 6) and (not (song / 'tmp').exists() and (not (song / '__pycache__').exists()))


def test_remove_intermediate_directories_records_actions(tmp_path):
    actions, out = [], tmp_path / 'song'
    (out / "tmp").mkdir(parents=True)
    (out / "tmp/data").write_bytes(b"123")
    assert (cache_service._remove_intermediate_directories(out, actions) == 3) and (actions and 'tmp/' in actions[0])



def song(tmp_path, **changes): return make_song(tmp_path, **{'output_dir': str(tmp_path), **changes})

def test_optimize_song_handles_missing_and_complete_song(monkeypatch, tmp_path):
    database, _ = mock_song_lookup(monkeypatch, cache_service)
    assert cache_service.optimize_song_files("missing")["freed_bytes"] == 0
    database.close.assert_called_once_with()

    database.reset_mock()
    out = tmp_path / "song"
    separated = out / "separated"
    separated.mkdir(parents=True)
    source = out / "source.wav"
    source.write_bytes(b"authoritative")
    song_wav = out / "song.wav"
    song_wav.write_bytes(b"1234567890")
    instrumental = separated / "instrumental.wav"
    instrumental.write_bytes(b"12345678")
    (out / "manifest.json").write_text(
        '{"outputs":{"song":"song.wav","instrumental":"separated/instrumental.wav"},"integrity":{}}',
        encoding="utf-8",
    )
    current = song(out, source_path=str(source), output_dir=str(out))
    cache_service.repositories.get_song.return_value = current
    monkeypatch.setattr(cache_service.song_service, "resolve_output_dir", Mock(return_value=out))

    def mp3(_source, target): target.write_bytes(b'mp3')

    def flac(_source, target): target.write_bytes(b'flac')

    patch_attrs(monkeypatch, cache_service, _encode_mp3=mp3, _encode_flac=flac)
    commit = Mock()
    monkeypatch.setattr(cache_service, "commit", commit)

    result = cache_service.optimize_song_files("song")

    assert (current.optimized is True) and (current.source_path == str(source) and source.exists()) and (not song_wav.exists() and (out / 'song.mp3').exists()) and (not instrumental.exists() and (separated / 'instrumental.flac').exists()) and (result['freed_bytes'] > 0)
    commit.assert_called_once_with(database)
    database.close.assert_called_once_with()


def test_optimize_commit_failure_restores_filesystem(monkeypatch, tmp_path):
    database = Mock()
    monkeypatch.setattr(cache_service, "SessionLocal", Mock(return_value=database))
    out = tmp_path / "song"
    separated = out / "separated"
    separated.mkdir(parents=True)
    source = out / "source.wav"
    source.write_bytes(b"original-source")
    song_wav = out / "song.wav"
    song_wav.write_bytes(b"song-wave")
    instrumental = separated / "instrumental.wav"
    instrumental.write_bytes(b"instrumental-wave")
    manifest = '{"outputs":{"song":"song.wav","instrumental":"separated/instrumental.wav"},"integrity":{}}'
    (out / "manifest.json").write_text(manifest, encoding="utf-8")
    current = song(out, source_path=str(source), output_dir=str(out), optimized=False)
    patch_many(monkeypatch, (cache_service.repositories, "get_song", Mock(return_value=current)), (cache_service.song_service, "resolve_output_dir", Mock(return_value=out)))
    patch_attrs(monkeypatch, cache_service, _encode_mp3=lambda _s, t: t.write_bytes(b'mp3'), _encode_flac=lambda _s, t: t.write_bytes(b'flac'), commit=Mock(side_effect=RuntimeError('commit failed')))

    raises(RuntimeError, lambda: cache_service.optimize_song_files('song'), match='commit failed')

    assert (source.exists() and song_wav.exists() and instrumental.exists()) and (not (out / 'song.mp3').exists()) and (not (separated / 'instrumental.flac').exists()) and (not (out / cache_service._OPTIMIZATION_JOURNAL).exists())
    restored = cache_service.read_json(out / "manifest.json")
    assert (restored['outputs']['song'], restored['outputs']['instrumental']) == ('song.wav', 'separated/instrumental.wav')


def test_optimize_song_closes_database_when_service_fails(monkeypatch, tmp_path):
    database, _ = mock_song_lookup(monkeypatch, cache_service, make_song(tmp_path))
    patch_attrs(monkeypatch, cache_service.song_service, resolve_output_dir=Mock(side_effect=RuntimeError('invalid path')))
    raises(RuntimeError, lambda: cache_service.optimize_song_files('song'), match='invalid path')
    database.close.assert_called_once_with()


def test_prepare_optimization_failure_is_all_or_nothing(monkeypatch, tmp_path):
    separated = tmp_path / "separated"
    separated.mkdir()
    (tmp_path / "song.wav").write_bytes(b"song")
    (separated / "instrumental.wav").write_bytes(b"stem")
    original_manifest = {
        "outputs": {"song": "song.wav", "instrumental": "separated/instrumental.wav"},
        "integrity": {},
    }
    cache_service.write_json(tmp_path / "manifest.json", original_manifest)
    patch_attrs(monkeypatch, cache_service, _encode_mp3=lambda _s, t: t.write_bytes(b'mp3'), _encode_flac=lambda _s, t: (t.write_bytes(b'partial'), (_ for _ in ()).throw(RuntimeError('fail')))[1])
    raises(RuntimeError, lambda: cache_service._prepare_optimization(tmp_path, []), match='fail')
    assert ((tmp_path / 'song.wav').exists()) and ((separated / 'instrumental.wav').exists()) and (not (tmp_path / 'song.mp3').exists()) and (not (separated / 'instrumental.flac').exists()) and (cache_service.read_json(tmp_path / 'manifest.json') == original_manifest)


@pytest.mark.parametrize(
    ("committed", "key", "value"),
    [
        (False, "created", "../victim.txt"),
        (False, "created", "../../victim.txt"),
        (False, "created", "C:\\victim.txt"),
        (True, "retire", "/absolute/victim.txt"),
        (True, "retire", "../victim.txt"),
    ],
)
def test_optimization_recovery_rejects_unsafe_journal_paths(tmp_path, committed, key, value):
    out = tmp_path / "song"
    out.mkdir()
    victim = tmp_path / "victim.txt"
    victim.write_text("keep", encoding="utf-8")
    cache_service.write_json(
        out / cache_service._OPTIMIZATION_JOURNAL,
        {"manifest_before": {}, "created": [], "retire": [], key: [value]},
    )
    raises(ValueError, lambda: cache_service._recover_optimization(out, committed=committed), match='journal|path')
    assert victim.read_text(encoding="utf-8") == "keep"


def test_optimize_partial_encoder_failure_keeps_retryable_state(monkeypatch, tmp_path):
    database = Mock()
    monkeypatch.setattr(cache_service, "SessionLocal", Mock(return_value=database))
    out = tmp_path / "song"
    separated = out / "separated"
    separated.mkdir(parents=True)
    source = out / "source.wav"
    source.write_bytes(b"source")
    (out / "song.wav").write_bytes(b"song")
    (separated / "instrumental.wav").write_bytes(b"stem")
    cache_service.write_json(
        out / "manifest.json",
        {"outputs": {"song": "song.wav", "instrumental": "separated/instrumental.wav"}, "integrity": {}},
    )
    current = song(out, source_path=str(source), output_dir=str(out), optimized=False)
    patch_many(monkeypatch, (cache_service.repositories, "get_song", Mock(return_value=current)), (cache_service.song_service, "resolve_output_dir", Mock(return_value=out)))
    patch_attrs(monkeypatch, cache_service, _encode_mp3=lambda _s, t: t.write_bytes(b'mp3'), _encode_flac=Mock(side_effect=RuntimeError('codec failed')))
    commit = Mock()
    monkeypatch.setattr(cache_service, "commit", commit)

    raises(RuntimeError, lambda: cache_service.optimize_song_files('song'), match='codec failed')

    assert (current.optimized is False) and ((out / 'song.wav').exists() and (separated / 'instrumental.wav').exists()) and (not (out / 'song.mp3').exists() and (not (separated / 'instrumental.flac').exists()))
    commit.assert_not_called()


def test_safe_journal_path_accepts_only_contained_portable_paths(tmp_path):
    out = tmp_path / "song"
    target = out / "separated" / "instrumental.flac"
    target.parent.mkdir(parents=True)
    assert cache_service._safe_journal_path(out, "separated/instrumental.flac") == target.resolve()
    for value in (None, "", "a\\b", "C:/x", "../x", "/x", ".", "x/../y"): raises(ValueError, lambda: cache_service._safe_journal_path(out, value))


def test_committed_stale_optimization_journal_never_retires_new_generation(tmp_path):
    out = tmp_path / "song"
    separated = out / "separated"
    separated.mkdir(parents=True)
    current = {
        "outputs": {
            "song": "song.wav",
            "vocals": "separated/vocals.wav",
            "instrumental": "separated/instrumental.wav",
        }
    }
    cache_service.write_json(out / "manifest.json", current)
    for relative in ("song.wav", "separated/vocals.wav", "separated/instrumental.wav"):
        path = out / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"NEW-GENERATION")
    cache_service.write_json(
        out / cache_service._OPTIMIZATION_JOURNAL,
        {
            "manifest_before": {},
            "created": ["song.mp3", "separated/vocals.flac", "separated/instrumental.flac"],
            "retire": ["song.wav", "separated/vocals.wav", "separated/instrumental.wav"],
            "published_outputs": {
                "song": "song.mp3",
                "vocals": "separated/vocals.flac",
                "instrumental": "separated/instrumental.flac",
            },
        },
    )

    cache_service._recover_optimization(out, committed=True)

    assert ((out / 'song.wav').read_bytes() == b'NEW-GENERATION') and ((out / 'separated/vocals.wav').exists()) and ((out / 'separated/instrumental.wav').exists()) and (not (out / cache_service._OPTIMIZATION_JOURNAL).exists())


def test_startup_optimization_recovery_scans_journals(monkeypatch, tmp_path):
    database, current, out = Mock(), SimpleNamespace(id='song', optimized=True), tmp_path / 'song'
    out.mkdir()
    (out / cache_service._OPTIMIZATION_JOURNAL).write_text("{}", encoding="utf-8")
    monkeypatch.setattr(cache_service, "SessionLocal", Mock(return_value=database))
    patch_attrs(monkeypatch, cache_service.song_service, list_songs=Mock(return_value=[current]), resolve_output_dir=Mock(return_value=out))
    recover = Mock()
    monkeypatch.setattr(cache_service, "_recover_optimization", recover)
    invalidate = Mock()
    monkeypatch.setattr(cache_service.revision_cache, "invalidate", invalidate)

    cache_service.recover_optimization_transactions()

    database.refresh.assert_called_once_with(current)
    recover.assert_called_once_with(out, committed=True)
    invalidate.assert_called_once_with(current)
    database.close.assert_called_once_with()


def test_startup_optimization_recovery_is_fail_closed_per_song(monkeypatch, tmp_path):
    database, current, out = Mock(), SimpleNamespace(id='song', optimized=False), tmp_path / 'song'
    out.mkdir()
    (out / cache_service._OPTIMIZATION_JOURNAL).write_text("{}", encoding="utf-8")
    monkeypatch.setattr(cache_service, "SessionLocal", Mock(return_value=database))
    patch_attrs(monkeypatch, cache_service.song_service, list_songs=Mock(return_value=[current]), resolve_output_dir=Mock(return_value=out))
    monkeypatch.setattr(cache_service, "_recover_optimization", Mock(side_effect=ValueError("bad journal")))

    cache_service.recover_optimization_transactions()

    database.rollback.assert_called_once_with()
    database.close.assert_called_once_with()
