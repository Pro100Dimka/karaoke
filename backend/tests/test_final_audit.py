from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.routers import songs as songs_router
from app.services import audio_service, cache_service


def _audio_settings(**overrides):
    values = {
        "input_device_id": None,
        "input_device_name": None,
        "output_device_id": None,
        "volume": 1.0,
        "sensitivity": 0.5,
        "latency_ms": 50,
        "audio_driver": "auto",
        "asio_driver_name": None,
        "buffer_size": 64,
        "monitoring_enabled": True,
        "reverb": 0.0,
        "echo": 0.0,
        "delay": 0.0,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_song_package_router_has_path_available():
    # Regression: import_song_package used Path(...) without importing pathlib.Path.
    assert songs_router.Path is Path


def test_audio_settings_restore_runtime_when_commit_fails(monkeypatch):
    settings = _audio_settings(buffer_size=64)
    db = Mock()
    db.commit.side_effect = RuntimeError("database locked")
    monkeypatch.setattr(audio_service, "_get_or_create_settings", lambda _db: settings)
    configured = []
    monkeypatch.setattr(
        audio_service,
        "configure_monitoring",
        lambda current: configured.append(current.buffer_size),
    )

    with pytest.raises(RuntimeError, match="database locked"):
        audio_service.update_settings(db, {"buffer_size": 128})

    assert settings.buffer_size == 64
    assert configured == [128, 64]
    db.rollback.assert_called()


def test_audio_settings_restore_runtime_when_new_configuration_fails(monkeypatch):
    settings = _audio_settings(buffer_size=64)
    db = Mock()
    monkeypatch.setattr(audio_service, "_get_or_create_settings", lambda _db: settings)
    configured = []

    def configure(current):
        configured.append(current.buffer_size)
        if current.buffer_size == 128:
            raise RuntimeError("driver rejected buffer")

    monkeypatch.setattr(audio_service, "configure_monitoring", configure)

    with pytest.raises(RuntimeError, match="driver rejected buffer"):
        audio_service.update_settings(db, {"buffer_size": 128})

    assert settings.buffer_size == 64
    assert configured == [128, 64]
    db.commit.assert_not_called()
    db.rollback.assert_called_once_with()


def test_cache_optimization_rolls_back_failed_commit(monkeypatch, tmp_path):
    song = SimpleNamespace(id="song", output_dir=str(tmp_path), slug="song", optimized=False)
    db = Mock()
    db.commit.side_effect = RuntimeError("disk full")
    db.close = Mock()
    monkeypatch.setattr(cache_service, "SessionLocal", lambda: db)
    monkeypatch.setattr(cache_service.repositories, "get_song", lambda *_: song)
    monkeypatch.setattr(cache_service.song_service, "resolve_output_dir", lambda _song: tmp_path)
    monkeypatch.setattr(cache_service, "_convert_heavy_wavs", lambda *_: 0)
    monkeypatch.setattr(cache_service, "_remove_intermediate_directories", lambda *_: 0)

    with pytest.raises(RuntimeError, match="disk full"):
        cache_service.optimize_song_files("song")

    db.rollback.assert_called_once_with()
    db.close.assert_called_once_with()
