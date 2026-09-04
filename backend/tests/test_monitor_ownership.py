from unittest.mock import Mock

import numpy as np
import pytest

from app.services import audio_service, recording_service
from tests.test_audio_settings import settings
from tests.test_recording_session import make_session


@pytest.fixture
def capture(monkeypatch):
    monkeypatch.setattr(recording_service.sd, "query_devices", Mock(return_value={"max_output_channels": 2}))
    monkeypatch.setattr(recording_service.sd, "Stream", Mock(return_value=Mock()))
    monkeypatch.setattr(recording_service.sd, "WasapiSettings", lambda **kwargs: kwargs)
    session, _ = make_session(monkeypatch, monitor_mode="shared", noise_suppression=0)
    monkeypatch.setattr(recording_service, "_sessions", {"session": session})
    return session


def test_recording_owns_monitor_toggles_gain_and_shared_device(capture, monkeypatch):
    launch = Mock()
    monkeypatch.setattr(audio_service, "_launch_monitor_process", launch)
    monkeypatch.setattr(audio_service, "_stop_monitoring_process", Mock())
    monkeypatch.setattr(audio_service._monitor_control, "check", Mock())
    monkeypatch.setattr(audio_service._monitor_control, "publish", Mock())
    current = settings(monitoring_enabled=True, volume=1, noise_suppression=0)
    audio_service._configure_monitoring(current)
    samples = np.full((128, 1), .01, dtype=np.float32)
    output = np.empty((128, 2), dtype=np.float32)
    capture._monitoring_callback(samples, output, 128, None, None)
    first = output.copy()
    current.volume = 2
    audio_service._configure_monitoring(current)
    capture._monitoring_callback(samples, output, 128, None, None)
    assert np.max(np.abs(output)) > np.max(np.abs(first))
    launch.assert_not_called()
    assert recording_service.sd.Stream.call_count == 1
    assert recording_service.sd.Stream.call_args.kwargs["extra_settings"] == (
        {"exclusive": False, "auto_convert": True}, {"exclusive": False, "auto_convert": True})
    audio_service.stop_monitoring()
    capture._monitoring_callback(samples, output, 128, None, None)
    assert not output.any()
    assert not capture._closed  # Turning monitoring off must not stop recording.


def test_meter_uses_recording_samples_without_opening_another_microphone(capture, monkeypatch):
    monkeypatch.setattr(audio_service, "_AUDIO_BACKEND_AVAILABLE", True)
    rec = Mock(side_effect=AssertionError("extra microphone capture"))
    monkeypatch.setattr(audio_service.sd, "rec", rec)
    capture._callback(np.full((128, 1), .1, dtype=np.float32), 128, None, None)
    signal = audio_service.check_signal_quality(1)
    assert signal["rms_db"] == pytest.approx(-20)
    assert not signal["silent"]
    rec.assert_not_called()


def test_native_asio_keeps_its_monitor_owner(capture, monkeypatch):
    capture._monitor_owner = "asio"
    native = Mock()
    monkeypatch.setattr(audio_service, "_start_asio_monitor", native)
    monkeypatch.setattr(audio_service, "_stop_monitoring_process", Mock())
    monkeypatch.setattr(audio_service._monitor_control, "check", Mock())
    current = settings(audio_driver="asio", asio_driver_name="Test ASIO", monitoring_enabled=True)
    audio_service._configure_monitoring(current)
    native.assert_called_once_with(current, adopt_driver_buffer=False)
    assert not capture._monitoring_enabled


def test_room_never_gains_second_backend_monitor(capture):
    capture._monitor_owner = "room"
    assert recording_service.apply_monitor_settings(settings(monitoring_enabled=True), "shared", False)
    recording_service.update_capture_controls({"monitoring_enabled": True})
    assert not capture._monitoring_enabled


def test_hardware_changes_rejected_before_persisting_during_recording(capture, monkeypatch):
    current = settings()
    database = Mock()
    monkeypatch.setattr(audio_service, "_get_or_create_settings", lambda _: current)
    with pytest.raises(RuntimeError, match="Stop recording"):
        audio_service.update_settings(database, {"buffer_size": 256})
    assert current.buffer_size == 64
    database.commit.assert_not_called()


def test_capture_stops_once_even_if_close_follows_stop(capture):
    capture.stop_capture()
    capture.stop_capture()
    capture._stream.stop.assert_called_once()
    capture._stream.close.assert_called_once()


def test_recording_gain_changes_even_when_monitoring_is_off(capture, monkeypatch):
    current = settings(monitoring_enabled=False)
    monkeypatch.setattr(audio_service, "_get_or_create_settings", lambda _: current)
    audio_service.update_settings(Mock(), {"volume": 1.7, "noise_suppression": .2})
    assert capture.gain == 1.7
    assert capture.noise_suppression == .2
    assert not capture._monitoring_enabled
