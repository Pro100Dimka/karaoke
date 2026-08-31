from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest

from app.services import monitor_worker, native_wasapi
from tools import probe_wasapi


def test_native_probe_uses_actual_rate_mutes_dsp_and_closes(monkeypatch):
    stats, callbacks = {}, []
    stream = SimpleNamespace(info=SimpleNamespace(sample_rate=44100), close=Mock(),
                             diagnostics=lambda: {"sample_rate": 44100})
    def create(options, statistics):
        assert options == {"input_device_name": "input", "output_device_name": "output", "blocksize": 64}
        stats["target"] = statistics
        return stream
    stream.start = callbacks.append
    def pump():
        target = stats["target"]
        target.update(rendered_frames=target.get("rendered_frames", 0) + 64,
                      program_residence_ms=.5, stream_latency_ms=30, queue_ms=0)
        output = np.ones((64, 1))
        callbacks[0](output.copy(), output, 64, None, None)
        assert np.all(output == 0)
    stream.pump = pump
    monkeypatch.setattr(native_wasapi, "NativeWasapiStream", create)
    monkeypatch.setattr(probe_wasapi.sd, "query_devices", lambda index: {"name": "input" if index == 1 else "output"})
    times = iter([0, .1, .3, .4, .5, 2])
    monkeypatch.setattr(probe_wasapi.time, "monotonic", lambda: next(times))
    factory = Mock(return_value=Mock())
    monkeypatch.setattr(monitor_worker, "_audio_callback", factory)
    result = probe_wasapi.probe_native({"input": 1, "output": 2, "blocksize": 64, "duration": 1, "dsp": True})
    factory.assert_called_once_with(2.0, 44100, stats["target"])
    assert result["timings"]["program_residence_ms"]["median"] == .5
    assert result["round_trip_latency_ms"] is None
    stream.close.assert_called_once()


def test_native_probe_closes_if_dsp_initialization_fails(monkeypatch):
    stream = SimpleNamespace(info=SimpleNamespace(sample_rate=44100), close=Mock())
    monkeypatch.setattr(native_wasapi, "NativeWasapiStream", lambda *_: stream)
    monkeypatch.setattr(probe_wasapi.sd, "query_devices", lambda _: {"name": "device"})
    monkeypatch.setattr(monitor_worker, "_audio_callback", Mock(side_effect=RuntimeError("DSP unavailable")))
    with pytest.raises(RuntimeError, match="DSP unavailable"):
        probe_wasapi.probe_native({"input": 1, "output": 2, "blocksize": 64, "duration": 1, "dsp": True})
    stream.close.assert_called_once()
