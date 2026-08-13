import builtins
import importlib
from unittest.mock import Mock

import numpy as np
import pytest

import models
from app.services import audio_service


def settings(**changes):
    values = {
        "id": 1,
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
    values.update(changes)
    return models.AudioSettings(**values)


def test_settings_are_loaded_or_created(monkeypatch):
    database = Mock()
    existing = settings()
    database.get.return_value = existing
    assert audio_service.get_settings(database) is existing

    database.get.return_value = None
    commit = Mock(side_effect=lambda _db, item: item)
    monkeypatch.setattr(audio_service, "commit_refresh", commit)
    created = audio_service.get_settings(database)
    assert isinstance(created, models.AudioSettings) and created.id == 1
    database.add.assert_called_once_with(created)


def test_input_device_name_is_bounded_and_backend_aware(monkeypatch):
    monkeypatch.setattr(audio_service, "_AUDIO_BACKEND_AVAILABLE", False)
    assert audio_service._input_device_name(0) is None
    monkeypatch.setattr(audio_service, "_AUDIO_BACKEND_AVAILABLE", True)
    monkeypatch.setattr(
        audio_service.sd,
        "query_devices",
        Mock(return_value=[{"name": "Mic"}, {"name": ""}]),
    )
    assert audio_service._input_device_name(0) == "Mic"
    assert audio_service._input_device_name(1) is None
    assert audio_service._input_device_name(3) is None
    assert audio_service._input_device_name(None) is None


def test_normalized_settings_patch_handles_defaults_devices_and_asio(monkeypatch):
    current = settings(input_device_id=1, input_device_name="Old", output_device_id=2)
    monkeypatch.setattr(audio_service, "_input_device_name", Mock(return_value="New"))
    updates, changed = audio_service._normalized_settings_patch(
        current,
        {
            "input_device_id": None,
            "output_device_id": None,
            "volume": None,
            "sensitivity": 0.5,
        },
    )
    assert updates == {
        "input_device_id": None,
        "input_device_name": None,
        "output_device_id": None,
    }
    assert changed == {"input_device_id", "output_device_id"}

    updates, changed = audio_service._normalized_settings_patch(current, {"input_device_id": 3})
    assert updates == {"input_device_id": 3, "input_device_name": "New"}
    assert changed == {"input_device_id"}

    with pytest.raises(RuntimeError, match="Unsupported"):
        audio_service._normalized_settings_patch(current, {"audio_driver": "invalid"})

    monkeypatch.setattr(audio_service, "list_asio_drivers", Mock(return_value=[]))
    with pytest.raises(RuntimeError, match="no ASIO"):
        audio_service._normalized_settings_patch(current, {"audio_driver": "asio"})

    monkeypatch.setattr(
        audio_service,
        "list_asio_drivers",
        Mock(return_value=["Studio ASIO", "USB ASIO"]),
    )
    updates, changed = audio_service._normalized_settings_patch(
        current,
        {"audio_driver": "asio", "asio_driver_name": "missing"},
    )
    assert updates["asio_driver_name"] == "Studio ASIO"
    assert "asio_driver_name" in changed


def test_update_settings_reconfigures_monitor_and_rolls_back(monkeypatch):
    current = settings(monitoring_enabled=True)
    database = Mock()
    monkeypatch.setattr(audio_service, "_get_or_create_settings", Mock(return_value=current))
    configure = Mock()
    monkeypatch.setattr(audio_service, "configure_monitoring", configure)

    result = audio_service.update_settings(database, {"volume": 2.0})
    assert result is current and current.volume == 2
    configure.assert_called_once_with(current)
    database.commit.assert_called_once_with()
    database.refresh.assert_called_once_with(current)

    database.reset_mock()
    configure.reset_mock()
    database.commit.side_effect = RuntimeError("database locked")
    with pytest.raises(RuntimeError, match="locked"):
        audio_service.update_settings(database, {"volume": 3.0})
    assert current.volume == 2
    assert configure.call_count == 2
    database.rollback.assert_called_once_with()

    configure.side_effect = [None, RuntimeError("restore device failed")]
    with pytest.raises(RuntimeError, match="locked"):
        audio_service.update_settings(database, {"volume": 3.0})


def test_set_monitoring_enabled_is_idempotent_and_transactional(monkeypatch):
    database = Mock()
    current = settings(monitoring_enabled=False)
    monkeypatch.setattr(audio_service, "get_settings", Mock(return_value=current))
    configure = Mock()
    stop = Mock()
    monkeypatch.setattr(audio_service, "configure_monitoring", configure)
    monkeypatch.setattr(audio_service, "stop_monitoring", stop)
    commit = Mock(side_effect=lambda _db, item: item)
    monkeypatch.setattr(audio_service, "commit_refresh", commit)

    assert audio_service.set_monitoring_enabled(database, False) is current
    stop.assert_called_once_with()
    assert audio_service.set_monitoring_enabled(database, True) is current
    assert current.monitoring_enabled is True
    commit.assert_called_once_with(database, current)

    configure.reset_mock()
    assert audio_service.set_monitoring_enabled(database, True) is current
    configure.assert_called_once_with(current)

    current.monitoring_enabled = False
    configure.side_effect = [RuntimeError("device failed"), RuntimeError("restore failed")]
    with pytest.raises(RuntimeError, match="device failed"):
        audio_service.set_monitoring_enabled(database, True)
    assert current.monitoring_enabled is False
    database.rollback.assert_called_once_with()


def test_configure_monitoring_routes_auto_and_asio(monkeypatch):
    stop = Mock()
    asio = Mock()
    worker = Mock()
    monkeypatch.setattr(audio_service, "stop_monitoring", stop)
    monkeypatch.setattr(audio_service, "_start_asio_monitor", asio)
    monkeypatch.setattr(audio_service, "_start_monitor_worker", worker)

    audio_service.configure_monitoring(settings(monitoring_enabled=False))
    stop.assert_called_once_with()
    asio.assert_not_called()

    audio_service.configure_monitoring(settings(monitoring_enabled=True, audio_driver="asio"))
    asio.assert_called_once()

    monkeypatch.setattr(audio_service, "_AUDIO_BACKEND_AVAILABLE", False)
    with pytest.raises(RuntimeError, match="unavailable"):
        audio_service.configure_monitoring(settings(monitoring_enabled=True))

    monkeypatch.setattr(audio_service, "_AUDIO_BACKEND_AVAILABLE", True)
    monkeypatch.setattr(audio_service, "preferred_input_device", Mock(return_value=1))
    monkeypatch.setattr(audio_service, "preferred_output_device", Mock(return_value=2))
    monkeypatch.setattr(audio_service, "_resolved_device_index", lambda value, _kind: value)
    devices = {
        1: {"hostapi": 0, "default_samplerate": 48_000, "max_input_channels": 1},
        2: {"hostapi": 0, "default_samplerate": 48_000, "max_output_channels": 2},
    }
    monkeypatch.setattr(audio_service.sd, "query_devices", lambda index: devices[index])
    monkeypatch.setattr(audio_service, "_is_wasapi_device", Mock(return_value=True))
    worker.reset_mock()
    audio_service.configure_monitoring(settings(monitoring_enabled=True, volume=8, buffer_size=128))
    assert worker.call_args.args[0] == {
        "input_device_id": 1,
        "output_device_id": 2,
        "sample_rate": 48_000.0,
        "output_channels": 2,
        "blocksize": 128,
        "gain": 4,
        "wasapi_exclusive": True,
    }

    devices[2]["max_output_channels"] = 0
    with pytest.raises(RuntimeError, match="No output"):
        audio_service.configure_monitoring(settings(monitoring_enabled=True))


def test_asio_monitor_validates_bridge_driver_and_clamps_command(monkeypatch, tmp_path):
    bridge = tmp_path / "bridge.exe"
    monkeypatch.setattr(audio_service, "_asio_bridge_path", Mock(return_value=bridge))
    with pytest.raises(RuntimeError, match="not built"):
        audio_service._start_asio_monitor(settings(audio_driver="asio"))

    bridge.write_bytes(b"bridge")
    monkeypatch.setattr(audio_service, "list_asio_drivers", Mock(return_value=["Studio ASIO"]))
    with pytest.raises(RuntimeError, match="unavailable"):
        audio_service._start_asio_monitor(settings(audio_driver="asio", asio_driver_name="Missing"))

    launch = Mock()
    monkeypatch.setattr(audio_service, "_launch_monitor_process", launch)
    audio_service._start_asio_monitor(
        settings(
            audio_driver="asio",
            asio_driver_name="Studio ASIO",
            volume=9,
            reverb=2,
            echo=-1,
            delay=0.5,
        )
    )
    command = launch.call_args.args[0]
    assert command[command.index("--gain") + 1] == "4.0"
    assert command[command.index("--reverb") + 1] == "1.0"
    assert command[command.index("--echo") + 1] == "0.0"
    assert launch.call_args.kwargs == {"cwd": tmp_path}


def test_signal_quality_uses_monitor_or_direct_capture(monkeypatch):
    monkeypatch.setattr(audio_service, "_AUDIO_BACKEND_AVAILABLE", False)
    with pytest.raises(RuntimeError, match="недоступен"):
        audio_service.check_signal_quality(None)

    monkeypatch.setattr(audio_service, "_AUDIO_BACKEND_AVAILABLE", True)
    live = Mock()
    live.poll.return_value = None
    monkeypatch.setattr(audio_service, "_monitor_process", live)
    monkeypatch.setattr(
        audio_service,
        "_monitor_signal",
        {"rms_db": -12.0, "clipping": False, "silent": False},
    )
    assert audio_service.check_signal_quality(None)["rms_db"] == -12

    dead = Mock()
    dead.poll.return_value = 1
    monkeypatch.setattr(audio_service, "_monitor_process", dead)
    assert audio_service.check_signal_quality(None, monitoring_expected=True)["silent"] is True
    assert audio_service._monitor_process is None

    monkeypatch.setattr(audio_service, "_monitor_process", None)
    monkeypatch.setattr(
        audio_service.sd,
        "rec",
        Mock(return_value=np.array([[0.5], [-0.5]], dtype=np.float32)),
    )
    monkeypatch.setattr(audio_service.sd, "wait", Mock())
    quality = audio_service.check_signal_quality(2, gain=2, duration_sec=0.1)
    assert quality == {"rms_db": 0.0, "clipping": True, "silent": False}

    audio_service.sd.rec.return_value = np.empty((0, 1), dtype=np.float32)
    assert audio_service.check_signal_quality(None)["rms_db"] == -120


def test_audio_backend_import_failure_is_soft(monkeypatch):
    original_import = builtins.__import__

    def blocked_import(name, *args, **kwargs):
        if name in {"numpy", "sounddevice"}:
            raise ImportError("audio stack missing")
        return original_import(name, *args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(builtins, "__import__", blocked_import)
        reloaded = importlib.reload(audio_service)
        assert reloaded._AUDIO_BACKEND_AVAILABLE is False
    importlib.reload(audio_service)
