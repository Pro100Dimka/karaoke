import asyncio
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

import schemas
from app import main
from app.routers import application, cache, diagnostics, player


def test_application_router_translates_service_validation(monkeypatch):
    monkeypatch.setattr(
        application.app_settings_service, "read_settings", Mock(return_value={"x": 1})
    )
    monkeypatch.setattr(
        application.app_settings_service,
        "read_ui_preferences",
        Mock(return_value={"karaoke": {"speed": 1}}),
    )
    assert application.get_settings() == {"x": 1}
    assert application.get_ui_preferences() == {"karaoke": {"speed": 1}}

    update = Mock(return_value={"theme": "dark"})
    monkeypatch.setattr(application.app_settings_service, "update_settings", update)
    assert application.update_settings(application.AppSettingsPatch(theme="dark")) == {
        "theme": "dark"
    }
    update.side_effect = ValueError("invalid path")
    with pytest.raises(HTTPException) as invalid:
        application.update_settings(application.AppSettingsPatch(theme="dark"))
    assert invalid.value.status_code == 422

    preferences = Mock(return_value={"speed": 1})
    monkeypatch.setattr(application.app_settings_service, "update_ui_preferences", preferences)
    assert application.update_ui_preferences("karaoke", {"speed": 1}) == {"speed": 1}
    preferences.side_effect = ValueError("unknown")
    with pytest.raises(HTTPException) as unknown:
        application.update_ui_preferences("unknown", {})
    assert unknown.value.status_code == 422
    assert application.about()["name"] == "A&D Voice"


def test_application_history_merges_and_sorts_processing_and_recordings():
    song_query = Mock()
    song_query.all.return_value = [
        SimpleNamespace(
            title="Processing",
            status=SimpleNamespace(value="processing"),
            updated_at=None,
        )
    ]
    recording = SimpleNamespace(
        duration_sec=12.5,
        created_at=SimpleNamespace(isoformat=lambda: "2026-01-02T00:00:00"),
    )
    recording_query = Mock()
    recording_query.join.return_value.outerjoin.return_value.all.return_value = [
        (recording, "Recorded", "analysis"),
        (SimpleNamespace(duration_sec=None, created_at=None), "Raw", None),
    ]
    database = Mock()
    database.query.side_effect = [song_query, recording_query]

    history = application.get_history(database)

    assert [item["song_title"] for item in history] == ["Recorded", "Processing", "Raw"]
    assert history[0]["status"] == "analyzed"
    assert history[-1]["status"] == "recorded"


def test_player_router_forwards_song_identity_and_payload(monkeypatch):
    song = SimpleNamespace(id="song")
    database = Mock()
    calls = {
        "get_sync_data": {"sync": True},
        "get_timeline": {"timeline": True},
        "get_state": "state",
        "seek": "seek",
        "set_playing": "playing",
        "stop": "stopped",
    }
    for name, result in calls.items():
        monkeypatch.setattr(player.player_service, name, Mock(return_value=result))
    assert player.get_sync(song) == {"sync": True}
    assert player.get_timeline(song) == {"timeline": True}
    assert player.get_position(song, database) == "state"
    assert player.seek(song, schemas.SeekRequest(position_sec=2.5), database) == "seek"
    assert player.pause(song, database) == "playing"
    player.player_service.set_playing.assert_called_with(database, "song", False)
    assert player.resume(song, database) == "playing"
    player.player_service.set_playing.assert_called_with(database, "song", True)
    assert player.stop(song, database) == "stopped"


def test_diagnostics_router_forwards_all_services(monkeypatch):
    health = {
        "ffmpeg_available": True,
        "demucs_available": True,
        "whisper_available": True,
        "torch_available": True,
        "cuda_available": False,
        "ai_dir_found": True,
        "runtime": {"selected": {"pitch": {"backend": "pytorch", "device": "cpu"}}},
    }
    monkeypatch.setattr(
        diagnostics.diagnostics_service, "pipeline_health", Mock(return_value=health)
    )
    monkeypatch.setattr(diagnostics.diagnostics_service, "versions", Mock(return_value={"v": 1}))
    monkeypatch.setattr(
        diagnostics.diagnostics_service, "recent_errors", Mock(return_value=[{"e": 1}])
    )
    monkeypatch.setattr(diagnostics.model_install_service, "status", Mock(return_value={"s": 1}))
    monkeypatch.setattr(
        diagnostics.model_install_service, "start_download", Mock(return_value={"s": 2})
    )
    assert diagnostics.health()["status"] == "ok"
    assert diagnostics.pipeline_health() == health
    assert diagnostics.models_health() == health
    assert diagnostics.ai_models_status() == {"s": 1}
    assert diagnostics.download_ai_models() == {"s": 2}
    assert diagnostics.versions() == {"v": 1}
    assert diagnostics.errors() == {"errors": [{"e": 1}]}


def test_cache_router_success_and_empty_optimization(monkeypatch):
    monkeypatch.setattr(cache.cache_service, "clear_temp_files", Mock(return_value=12))
    monkeypatch.setattr(cache.cache_service, "cache_size", Mock(return_value={"size": 1}))
    monkeypatch.setattr(cache.cache_service, "free_space", Mock(return_value={"free": 2}))
    assert cache.clear_cache() == {"freed_bytes": 12}
    assert cache.delete_temp() == {"freed_bytes": 12}
    assert cache.get_cache_size() == {"size": 1}
    assert cache.get_free_space() == {"free": 2}

    optimize = Mock(return_value={"actions": ["done"], "freed_bytes": 1})
    monkeypatch.setattr(cache.cache_service, "optimize_song_files", optimize)
    assert cache.optimize_song("song")["actions"] == ["done"]
    optimize.return_value = {"actions": [], "freed_bytes": 0}
    with pytest.raises(HTTPException) as empty:
        cache.optimize_song("song")
    assert empty.value.status_code == 404


def test_benign_disconnect_requires_known_windows_socket_code():
    error = ConnectionResetError()
    error.winerror = 10054
    assert main._is_benign_client_disconnect({"exception": error}) is True
    error.winerror = 1
    assert main._is_benign_client_disconnect({"exception": error}) is False
    assert main._is_benign_client_disconnect({}) is False


def test_lifespan_installs_handler_initializes_and_always_cleans(monkeypatch):
    loop = Mock()
    previous = Mock()
    loop.get_exception_handler.return_value = previous
    monkeypatch.setattr(main.asyncio, "get_running_loop", Mock(return_value=loop))
    initialize = Mock()
    migrate = Mock()
    close = Mock(side_effect=RuntimeError("close failed"))
    stop = Mock()
    reset_ai = Mock()
    monkeypatch.setattr(main, "init_db", initialize)
    monkeypatch.setattr(main.storage_migration, "migrate_legacy_song_storage", migrate)
    monkeypatch.setattr(main.recording_service, "close_all_sessions", close)
    monkeypatch.setattr(main.audio_service, "stop_monitoring", stop)
    monkeypatch.setattr(main.ai_service, "reset_ai_service", reset_ai)

    async def exercise():
        with pytest.raises(RuntimeError, match="close failed"):
            async with main.lifespan(main.app):
                pass

    asyncio.run(exercise())
    initialize.assert_called_once_with()
    migrate.assert_called_once_with()
    stop.assert_called_once_with()
    reset_ai.assert_called_once_with()
    assert loop.set_exception_handler.call_args_list[-1].args == (previous,)

    handler = loop.set_exception_handler.call_args_list[0].args[0]
    benign = ConnectionResetError()
    benign.winerror = 64
    handler(loop, {"exception": benign})
    previous.assert_not_called()
    handler(loop, {"exception": RuntimeError("bad")})
    previous.assert_called_once()


def test_lifespan_handler_uses_loop_default_without_previous(monkeypatch):
    loop = Mock()
    loop.get_exception_handler.return_value = None
    monkeypatch.setattr(main.asyncio, "get_running_loop", Mock(return_value=loop))
    monkeypatch.setattr(main, "init_db", Mock())
    monkeypatch.setattr(main.storage_migration, "migrate_legacy_song_storage", Mock())
    monkeypatch.setattr(main.recording_service, "close_all_sessions", Mock())
    monkeypatch.setattr(main.audio_service, "stop_monitoring", Mock())
    monkeypatch.setattr(main.ai_service, "reset_ai_service", Mock())

    async def exercise():
        async with main.lifespan(main.app):
            handler = loop.set_exception_handler.call_args.args[0]
            handler(loop, {"exception": RuntimeError("bad")})

    asyncio.run(exercise())
    loop.default_exception_handler.assert_called_once()
    assert main.root() == {"name": "A&D Voice Backend", "docs": "/docs"}
