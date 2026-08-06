from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

import schemas
from app.routers import application, audio, cache, diagnostics, player


def test_application_settings_and_about(monkeypatch):
    monkeypatch.setattr(application.app_settings_service, "read_settings", lambda: {"theme": "dark"})
    saved = []
    monkeypatch.setattr(
        application.app_settings_service,
        "update_settings",
        lambda values: saved.append(values) or values,
    )

    assert application.get_settings() == {"theme": "dark"}
    patch = application.AppSettingsPatch(theme="light", thread_count=4)
    assert application.update_settings(patch) == {"theme": "light", "thread_count": 4}
    assert saved == [{"theme": "light", "thread_count": 4}]
    assert application.about()["name"] == "Karaoke Studio"


def test_application_settings_require_compute_target():
    with pytest.raises(ValueError, match="compute target"):
        application.AppSettingsPatch(use_gpu=False, use_cpu=False)


def test_audio_router_delegates_and_maps_runtime_errors(monkeypatch):
    db = Mock()
    settings = SimpleNamespace(
        input_device_id=3,
        volume=0.8,
        monitoring_enabled=True,
    )
    monkeypatch.setattr(audio.audio_service, "list_input_devices", lambda: [{"index": 1}])
    monkeypatch.setattr(audio.audio_service, "list_output_devices", lambda: [{"index": 2}])
    monkeypatch.setattr(audio.audio_service, "list_asio_drivers", lambda: ["ASIO"])
    monkeypatch.setattr(audio.audio_service, "get_settings", lambda _db: settings)
    monkeypatch.setattr(audio.audio_service, "set_monitoring_enabled", lambda _db, enabled: enabled)
    monkeypatch.setattr(audio.audio_service, "update_settings", lambda _db, values: values)
    monkeypatch.setattr(
        audio.audio_service,
        "check_signal_quality",
        lambda device, **kwargs: {"device": device, **kwargs},
    )

    assert audio.list_devices() == [{"index": 1}]
    assert audio.list_output_devices() == [{"index": 2}]
    assert audio.list_asio_drivers() == [{"name": "ASIO"}]
    assert audio.get_settings(db) is settings
    assert audio.start_direct_monitoring(db) is True
    assert audio.stop_direct_monitoring(db) is False
    assert audio.select_device(5, db) == {"input_device_id": 5}
    assert audio.signal_quality(db)["device"] == 3

    monkeypatch.setattr(
        audio.audio_service,
        "update_settings",
        lambda *_: (_ for _ in ()).throw(RuntimeError("driver unavailable")),
    )
    with pytest.raises(HTTPException) as error:
        audio.update_settings(schemas.AudioSettingsUpdate(volume=0.5), db)
    assert error.value.status_code == 503


def test_cache_router_contracts(monkeypatch):
    monkeypatch.setattr(cache.cache_service, "cache_size", lambda: {"bytes": 1})
    monkeypatch.setattr(cache.cache_service, "free_space", lambda: {"bytes": 2})
    monkeypatch.setattr(cache.cache_service, "clear_temp_files", lambda: 3)
    monkeypatch.setattr(
        cache.cache_service,
        "optimize_song_files",
        lambda _song_id: {"song_id": "song", "freed_bytes": 4, "actions": ["done"]},
    )

    assert cache.get_cache_size() == {"bytes": 1}
    assert cache.get_free_space() == {"bytes": 2}
    assert cache.clear_cache() == {"freed_bytes": 3}
    assert cache.delete_temp() == {"freed_bytes": 3}
    assert cache.optimize_song("song")["freed_bytes"] == 4

    monkeypatch.setattr(
        cache.cache_service,
        "optimize_song_files",
        lambda _song_id: {"song_id": "song", "freed_bytes": 0, "actions": []},
    )
    with pytest.raises(HTTPException) as error:
        cache.optimize_song("song")
    assert error.value.status_code == 404


def test_diagnostics_router_contracts(monkeypatch):
    monkeypatch.setattr(diagnostics.diagnostics_service, "pipeline_health", lambda: {"ok": True})
    monkeypatch.setattr(diagnostics.diagnostics_service, "versions", lambda: {"python": "x"})
    monkeypatch.setattr(diagnostics.diagnostics_service, "recent_errors", lambda: [{"id": 1}])

    assert diagnostics.health()["status"] == "ok"
    assert diagnostics.pipeline_health() == {"ok": True}
    assert diagnostics.models_health() == {"ok": True}
    assert diagnostics.versions() == {"python": "x"}
    assert diagnostics.errors() == {"errors": [{"id": 1}]}


def test_player_router_delegates(monkeypatch):
    song = SimpleNamespace(id="song")
    db = Mock()
    monkeypatch.setattr(player.player_service, "get_sync_data", lambda value: ("sync", value.id))
    monkeypatch.setattr(player.player_service, "get_timeline", lambda value: ("timeline", value.id))
    monkeypatch.setattr(player.player_service, "get_state", lambda _db, song_id: ("state", song_id))
    monkeypatch.setattr(player.player_service, "seek", lambda _db, song_id, position: (song_id, position))
    monkeypatch.setattr(player.player_service, "set_playing", lambda _db, song_id, playing: (song_id, playing))
    monkeypatch.setattr(player.player_service, "stop", lambda _db, song_id: ("stop", song_id))

    assert player.get_sync(song) == ("sync", "song")
    assert player.get_timeline(song) == ("timeline", "song")
    assert player.get_position(song, db) == ("state", "song")
    assert player.seek(song, schemas.SeekRequest(position_sec=12.5), db) == ("song", 12.5)
    assert player.pause(song, db) == ("song", False)
    assert player.resume(song, db) == ("song", True)
    assert player.stop(song, db) == ("stop", "song")
