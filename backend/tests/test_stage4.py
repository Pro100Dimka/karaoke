import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import models
from app.main import app
from app.routers.recording import _change_session_state
from app.routers.songs import _processing_status
from app.services import app_settings_service, recording_service
from app.utils.json_files import write_json


def test_processing_status_maps_telemetry() -> None:
    song = SimpleNamespace(
        id="song-1",
        status=models.SongStatus.PROCESSING,
        progress_step="4/13",
        progress_percent=25.0,
        error_message=None,
    )
    status = _processing_status(
        song,
        telemetry={"progress_detail": "Separating", "eta_seconds": 42},
    )
    assert status.song_id == "song-1"
    assert status.progress_detail == "Separating"
    assert status.eta_seconds == 42


def test_processing_status_defaults_optional_telemetry() -> None:
    song = SimpleNamespace(
        id="song-1",
        status=models.SongStatus.PENDING,
        progress_step=None,
        progress_percent=0.0,
        error_message=None,
    )
    status = _processing_status(song)
    assert status.progress_detail is None
    assert status.eta_seconds is None


def test_change_session_state_returns_status() -> None:
    calls: list[str] = []
    result = _change_session_state("session", calls.append, "paused")
    assert calls == ["session"]
    assert result == {"status": "paused"}


def test_change_session_state_converts_missing_session_to_404() -> None:
    def fail(_: str) -> None:
        raise KeyError("missing")

    with pytest.raises(HTTPException) as exc_info:
        _change_session_state("session", fail, "paused")
    assert exc_info.value.status_code == 404


def test_require_session_returns_registered_session(monkeypatch) -> None:
    marker = object()
    monkeypatch.setitem(recording_service._sessions, "known", marker)
    assert recording_service._require_session("known") is marker


def test_require_session_rejects_unknown_session() -> None:
    with pytest.raises(KeyError, match="was not found"):
        recording_service._require_session("unknown")


def test_application_settings_ignore_unknown_keys(tmp_path: Path, monkeypatch) -> None:
    settings_file = tmp_path / "settings.json"
    settings_file.write_text(
        json.dumps({"theme": "light", "unknown": "ignored"}), encoding="utf-8"
    )
    monkeypatch.setattr(app_settings_service, "SETTINGS_FILE", settings_file)
    settings = app_settings_service.read_settings()
    assert settings["theme"] == "light"
    assert "unknown" not in settings


def test_application_settings_survive_invalid_json(tmp_path: Path, monkeypatch) -> None:
    settings_file = tmp_path / "settings.json"
    settings_file.write_text("{broken", encoding="utf-8")
    monkeypatch.setattr(app_settings_service, "SETTINGS_FILE", settings_file)
    assert app_settings_service.read_settings()["theme"] == "dark"


def test_write_json_removes_temporary_file_after_serialization_error(tmp_path: Path) -> None:
    path = tmp_path / "data.json"
    with pytest.raises(TypeError):
        write_json(path, {"bad": object()})
    assert not path.exists()
    assert not path.with_suffix(".json.tmp").exists()


def test_openapi_contains_refactored_song_routes() -> None:
    with TestClient(app) as client:
        schema = client.get("/openapi.json")
    assert schema.status_code == 200
    paths = schema.json()["paths"]
    assert "/songs/{song_id}/status" in paths
    assert "/songs/{song_id}/audio/{track}" in paths
