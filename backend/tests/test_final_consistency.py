from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy.exc import IntegrityError

import schemas
from app.services import player_service, song_service


class _SongDb:
    def __init__(self):
        self.committed = False
        self.rolled_back = False

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def refresh(self, _instance):
        pass


def test_song_patch_validates_range_against_existing_other_bound():
    song = SimpleNamespace(note_range_min=40, note_range_max=70)
    patch = schemas.SongUpdate(note_range_min=80)
    db = _SongDb()

    with pytest.raises(ValueError, match="must not exceed"):
        song_service.update_song(db, song, patch)

    assert song.note_range_min == 40
    assert db.committed is False


def test_song_patch_allows_clearing_one_range_bound():
    song = SimpleNamespace(note_range_min=40, note_range_max=70)
    patch = schemas.SongUpdate(note_range_max=None)
    db = _SongDb()

    result = song_service.update_song(db, song, patch)

    assert result.note_range_max is None
    assert db.committed is True


class _PlaybackDb:
    def __init__(self):
        self.added = None
        self.rollback_calls = 0

    def add(self, value):
        self.added = value

    def rollback(self):
        self.rollback_calls += 1


def test_playback_state_recovers_from_concurrent_creation(monkeypatch):
    db = _PlaybackDb()
    winner = SimpleNamespace(song_id="song", position_sec=12.0, is_playing=True)
    lookups = iter((None, winner))
    monkeypatch.setattr(
        player_service.repositories,
        "get_playback_state",
        lambda *_args: next(lookups),
    )
    monkeypatch.setattr(
        player_service,
        "commit_refresh",
        lambda *_args: (_ for _ in ()).throw(
            IntegrityError("insert", {}, RuntimeError("duplicate"))
        ),
    )

    result = player_service._get_or_create_state(db, "song")

    assert result is winner
    assert db.rollback_calls == 1


def test_playback_state_reraises_if_concurrent_row_is_not_visible(monkeypatch):
    db = _PlaybackDb()
    monkeypatch.setattr(
        player_service.repositories,
        "get_playback_state",
        lambda *_args: None,
    )
    monkeypatch.setattr(
        player_service,
        "commit_refresh",
        lambda *_args: (_ for _ in ()).throw(
            IntegrityError("insert", {}, RuntimeError("duplicate"))
        ),
    )

    with pytest.raises(IntegrityError):
        player_service._get_or_create_state(db, "song")

    assert db.rollback_calls == 1


def test_app_settings_reject_disabling_last_compute_target(monkeypatch):
    from app.services import app_settings_service

    monkeypatch.setattr(
        app_settings_service,
        "read_settings",
        lambda: {**app_settings_service.DEFAULT_SETTINGS, "use_gpu": False, "use_cpu": True},
    )
    monkeypatch.setattr(
        app_settings_service,
        "write_json",
        lambda *_args, **_kwargs: pytest.fail("invalid settings must not be written"),
    )

    with pytest.raises(ValueError, match="At least one"):
        app_settings_service.update_settings({"use_cpu": False})


def test_audio_settings_monitoring_toggle_reconfigures_runtime(monkeypatch):
    from app.services import audio_service

    settings = SimpleNamespace(
        monitoring_enabled=False,
        audio_driver="auto",
        asio_driver_name=None,
        input_device_id=None,
        input_device_name=None,
        output_device_id=None,
        volume=1.0,
        sensitivity=0.5,
        latency_ms=50,
        buffer_size=64,
        reverb=0.0,
        echo=0.0,
        delay=0.0,
    )
    calls = []

    class Db:
        def commit(self):
            pass

        def rollback(self):
            pass

        def refresh(self, _instance):
            pass

    monkeypatch.setattr(audio_service, "_get_or_create_settings", lambda _db: settings)
    monkeypatch.setattr(
        audio_service, "configure_monitoring", lambda value: calls.append(value.monitoring_enabled)
    )

    result = audio_service.update_settings(Db(), {"monitoring_enabled": True})

    assert result.monitoring_enabled is True
    assert calls == [True]


def test_song_patch_converts_combined_range_error_to_422(monkeypatch):
    from fastapi import HTTPException

    from app.routers import songs

    monkeypatch.setattr(
        songs.song_service,
        "update_song",
        lambda *_args: (_ for _ in ()).throw(ValueError("invalid range")),
    )

    with pytest.raises(HTTPException) as exc_info:
        songs.patch_song(SimpleNamespace(), schemas.SongUpdate(title="Title"), SimpleNamespace())

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "invalid range"


def test_application_settings_converts_merged_validation_error_to_422(monkeypatch):
    from fastapi import HTTPException

    from app.routers import application

    monkeypatch.setattr(
        application.app_settings_service,
        "update_settings",
        lambda *_args: (_ for _ in ()).throw(ValueError("invalid compute target")),
    )

    with pytest.raises(HTTPException) as exc_info:
        application.update_settings(application.AppSettingsPatch(use_cpu=False))

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "invalid compute target"
