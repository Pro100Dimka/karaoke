from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.services import audio_service


def _settings(**overrides):
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
        "monitoring_enabled": False,
        "reverb": 0.0,
        "echo": 0.0,
        "delay": 0.0,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_invalid_audio_driver_does_not_mutate_settings():
    settings = _settings()
    with pytest.raises(RuntimeError, match="Unsupported audio driver"):
        audio_service._normalized_settings_patch(settings, {"audio_driver": "wasapi"})
    assert settings.audio_driver == "auto"


def test_asio_patch_selects_first_available_driver(monkeypatch):
    settings = _settings()
    monkeypatch.setattr(audio_service, "list_asio_drivers", lambda: ["Audient ASIO"])
    updates, changed = audio_service._normalized_settings_patch(
        settings, {"audio_driver": "asio"}
    )
    assert updates == {"audio_driver": "asio", "asio_driver_name": "Audient ASIO"}
    assert changed == {"audio_driver", "asio_driver_name"}


def test_update_settings_rolls_back_commit_failure(monkeypatch):
    settings = _settings()
    db = Mock()
    db.commit.side_effect = RuntimeError("database locked")
    monkeypatch.setattr(audio_service, "_get_or_create_settings", lambda _db: settings)

    with pytest.raises(RuntimeError, match="database locked"):
        audio_service.update_settings(db, {"volume": 0.5})

    db.rollback.assert_called_once_with()


def test_unrelated_setting_does_not_restart_monitor(monkeypatch):
    settings = _settings(monitoring_enabled=True)
    db = Mock()
    monkeypatch.setattr(audio_service, "_get_or_create_settings", lambda _db: settings)
    monitor = Mock()
    monkeypatch.setattr(audio_service, "configure_monitoring", monitor)

    audio_service.update_settings(db, {"sensitivity": 0.7})

    monitor.assert_not_called()


def test_device_lists_share_same_shape(monkeypatch):
    monkeypatch.setattr(audio_service, "_AUDIO_BACKEND_AVAILABLE", True)
    fake_sd = SimpleNamespace()
    monkeypatch.setattr(audio_service, "sd", fake_sd, raising=False)
    monkeypatch.setattr(
        fake_sd,
        "query_devices",
        lambda: [
            {"name": "Mic", "hostapi": 0, "max_input_channels": 1, "max_output_channels": 0, "default_samplerate": 48000},
            {"name": "Out", "hostapi": 0, "max_input_channels": 0, "max_output_channels": 2, "default_samplerate": 48000},
        ],
        raising=False,
    )
    monkeypatch.setattr(audio_service, "_host_api_name", lambda _device: "WASAPI")

    assert audio_service.list_input_devices()[0]["max_input_channels"] == 1
    assert audio_service.list_output_devices()[0]["max_output_channels"] == 2
