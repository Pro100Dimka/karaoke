import ctypes as ct
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest

from app.services import native_wasapi, monitor_worker


def options():
    return {"input_device_name": "Chosen microphone", "output_device_name": "Chosen speakers", "blocksize": 64}


@pytest.fixture
def dll(monkeypatch):
    library = SimpleNamespace(wm_close=Mock(), wm_start=Mock(return_value=1), wm_pump=Mock(return_value=1))
    def open_stream(input_name, output_name, blocksize, info, _error, _size):
        assert (input_name, output_name, blocksize) == ("Chosen microphone", "Chosen speakers", 64)
        for name, value in {"sample_rate": 44100, "output_sample_rate": 48000, "blocksize": 64,
                            "input_period": 441, "output_period": 144,
                            "input_latency_ms": 10, "output_latency_ms": 3}.items():
            setattr(info._obj, name, value)
        return 42
    library.wm_open = Mock(side_effect=open_stream)
    monkeypatch.setattr(native_wasapi, "load_library", lambda: library)
    return library


def test_native_stream_reports_real_format_and_periods_without_changing_settings(dll):
    requested = options()
    stream = native_wasapi.NativeWasapiStream(requested, {})
    info = stream.diagnostics()
    assert info["sample_rate"] == 44100 and info["output_sample_rate"] == 48000
    assert info["blocksize"] == 64 and info["input_period_frames"] == 441
    assert info["latency_source"] == "wasapi-stream-report" and not info["exclusive"]
    assert requested == options()
    stream.close()
    stream.close()
    dll.wm_close.assert_called_once_with(42)


def test_native_callback_reuses_existing_dsp_and_supports_partial_engine_packets(dll):
    stats = {}
    stream = native_wasapi.NativeWasapiStream(options(), stats)
    def dsp(source, output, frames, _clock, _status):
        assert source.shape == output.shape == (frames, 1)
        output[:] = source * .5
    stream.start(dsp)
    for frames in (64, 57):
        source = (ct.c_float * frames)(*([.4] * frames))
        output = (ct.c_float * frames)()
        assert stream.callback(source, output, frames) == 1
        assert np.allclose(output, .2)
    stream.close()


def test_callback_failure_stops_native_output_instead_of_replaying_old_block(dll):
    stats = {}
    stream = native_wasapi.NativeWasapiStream(options(), stats)
    stream.start(Mock(side_effect=RuntimeError("DSP failed")))
    samples = (ct.c_float * 4)()
    assert stream.callback(samples, samples, 4) == 0
    assert stats["callback_error"] == "DSP failed"
    stream.close()


def test_start_failure_and_idempotent_cleanup(dll):
    stream = native_wasapi.NativeWasapiStream(options(), {})
    dll.wm_start.return_value = 0
    stream.error.value = b"Device invalidated"
    with pytest.raises(RuntimeError, match="Device invalidated"):
        stream.start(Mock())
    stream.abort()
    stream.close()
    dll.wm_close.assert_called_once_with(42)


def test_missing_library_is_not_silently_replaced_with_slow_duplex(monkeypatch, tmp_path):
    monkeypatch.setattr(native_wasapi, "library_path", lambda: tmp_path / "missing.dll")
    with pytest.raises(RuntimeError, match="missing"):
        native_wasapi.load_library()


def test_native_pump_failure_is_reported(dll):
    stream = native_wasapi.NativeWasapiStream(options(), {})
    stream.error.value = b"Audio device disconnected"
    dll.wm_pump.return_value = 0
    with pytest.raises(RuntimeError, match="disconnected"):
        stream.pump()
    stream.close()


def test_native_shared_candidate_does_not_switch_mode_or_buffer():
    config = {"sample_rate": 48000, "blocksize": 64, "input_device_id": 1, "output_device_id": 2,
              "output_channels": 2, "wasapi_mode": "shared", "native_shared": True}
    candidate, = monitor_worker._stream_candidates(config)
    assert candidate["_engine"] == "wasapi-native-shared"
    assert candidate["_mode"] == "shared" and candidate["blocksize"] == 64
    with pytest.raises(ValueError):
        monitor_worker._stream_candidates({**config, "wasapi_mode": "exclusive"})


def test_worker_uses_native_event_pump_and_native_rate(monkeypatch, dll, capsys):
    import json
    import sys
    config = {**options(), "sample_rate": 48000, "input_device_id": 1, "output_device_id": 2,
              "output_channels": 2, "gain": 1, "wasapi_mode": "shared", "native_shared": True}
    monkeypatch.setattr(sys, "argv", ["monitor_worker", "--config", json.dumps(config)])
    monkeypatch.setattr(monitor_worker, "_running", True)
    monkeypatch.setattr(monitor_worker.threading, "Thread", Mock())
    factory = Mock(return_value=Mock())
    monkeypatch.setattr(monitor_worker, "_audio_callback", factory)
    legacy = Mock(side_effect=AssertionError("Legacy duplex must not open"))
    monkeypatch.setattr(monitor_worker.sd, "Stream", legacy)
    def pump(*args):
        monitor_worker._running = False
        return 1
    dll.wm_pump.side_effect = pump
    assert monitor_worker.main() == 0
    assert factory.call_args.args[1] == 44100
    dll.wm_pump.assert_called_once()
    dll.wm_close.assert_called_once_with(42)
    legacy.assert_not_called()
    started = json.loads(capsys.readouterr().out.splitlines()[0])
    assert started["engine"] == "wasapi-native-shared"
    assert started["input_period_frames"] == 441
