import threading
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest

from app.services import wasapi_monitor_stream as monitor


def test_queue_is_bounded_and_keeps_newest_samples_without_aliasing():
    queue = monitor.MonitorQueue(128, 2)
    samples = np.zeros((128, 2), dtype=np.float32)
    for value in range(10):
        samples.fill(value)
        queue.push(samples)
        assert queue.size <= queue.capacity
    samples.fill(-1)
    output = np.empty_like(samples)
    for value in range(6, 10):
        assert queue.pop(output)
        assert np.all(output == value)
    assert not queue.pop(output)
    assert not output.any()
    assert queue.dropped_frames == 6 * 128
    assert queue.underruns == 1
    assert len(queue.free) == 6


def test_queue_measures_residence_time_not_capacity(monkeypatch):
    clock = [10.0]
    monkeypatch.setattr(monitor.time, "perf_counter", lambda: clock[0])
    queue = monitor.MonitorQueue(128, 2)
    samples = np.ones((128, 2), dtype=np.float32)
    queue.push(samples)
    clock[0] += .003
    queue.push(samples)
    clock[0] += .004
    assert queue.pop(samples)
    assert queue.last_wait_ms == 7
    assert queue.pop(samples)
    assert queue.last_wait_ms == 4
    assert not queue.pop(samples)
    assert queue.last_wait_ms is None


def test_queue_pool_is_safe_with_concurrent_producer_and_consumer():
    queue = monitor.MonitorQueue(128, 2)
    finished = threading.Event()
    def produce():
        for value in range(10000):
            queue.push(np.full((128, 2), value, dtype=np.float32))
        finished.set()
    producer = threading.Thread(target=produce)
    producer.start()
    output = np.empty((128, 2), dtype=np.float32)
    previous = -1
    while not finished.is_set() or queue.size:
        if queue.pop(output):
            assert np.all(output == output[0, 0])
            assert output[0, 0] > previous
            previous = output[0, 0]
    producer.join(timeout=2)
    assert not producer.is_alive()
    assert queue.contentions == 0
    assert len(queue.free) == 6


def setup_stream(callback=None):
    input_stream, output_stream = Mock(latency=.006), Mock(latency=.007)
    sd = SimpleNamespace(InputStream=Mock(return_value=input_stream), OutputStream=Mock(return_value=output_stream))
    config = dict(samplerate=44100, blocksize=128, channels=(1, 2), device=(3, 7), latency=.003,
                  extra_settings=("exclusive-input", "exclusive-output"))
    stats, restart = {}, threading.Event()
    callback = callback or (lambda data, output, *_: output.__setitem__(slice(None), data))
    stream = monitor.WasapiMonitorStream(sd, config, callback, stats, restart)
    return stream, sd, stats, restart


def test_split_stream_preserves_routes_and_copies_processed_audio():
    stream, sd, stats, restart = setup_stream()
    assert stream.latency == (.006, .007)
    assert sd.InputStream.call_args.kwargs["device"] == 3
    assert sd.OutputStream.call_args.kwargs["device"] == 7
    assert sd.InputStream.call_args.kwargs["extra_settings"] == "exclusive-input"
    assert sd.OutputStream.call_args.kwargs["extra_settings"] == "exclusive-output"
    stream.start()
    sd.InputStream.call_args.kwargs["callback"](np.ones((128, 1)), 128, None, None)
    sd.InputStream.call_args.kwargs["callback"](np.ones((128, 1)), 128, None, None)
    output = np.empty((128, 2), dtype=np.float32)
    sd.OutputStream.call_args.kwargs["callback"](output, 128, None, None)
    assert np.all(output == 1)
    assert not restart.is_set()
    assert stats["queue_frames"] == 128
    assert stats["queue_capacity_ms"] == 11.61
    stream.abort()
    stream.close()
    for endpoint in (stream.input, stream.output):
        endpoint.start.assert_called_once()
        endpoint.abort.assert_called_once()
        endpoint.close.assert_called_once()


def test_split_keeps_selected_configuration_despite_sustained_empty_queue(monkeypatch):
    stream, sd, stats, restart = setup_stream()
    stream.started_at = 0
    monkeypatch.setattr(monitor.time, "monotonic", lambda: 1)
    output = np.empty((128, 2), dtype=np.float32)
    render = sd.OutputStream.call_args.kwargs["callback"]
    for _ in range(11):
        render(output, 128, None, None)
    assert not restart.is_set()
    render(output, 128, None, None)
    assert not restart.is_set()
    assert stats["queue_underruns"] == 12
    assert not output.any()


def test_input_callback_errors_request_fallback():
    stream, sd, stats, restart = setup_stream(Mock(side_effect=ValueError("DSP failed")))
    sd.InputStream.call_args.kwargs["callback"](np.ones((128, 1)), 128, None, None)
    assert restart.is_set()
    assert stream.queue.size == 0


def test_split_primes_one_spare_block_and_reprimes_after_starvation():
    stream, sd, _, restart = setup_stream()
    capture = sd.InputStream.call_args.kwargs["callback"]
    render = sd.OutputStream.call_args.kwargs["callback"]
    output = np.empty((128, 2), dtype=np.float32)
    capture(np.ones((128, 1)), 128, None, None)
    render(output, 128, None, None)
    assert not output.any() and stream.queue.size == 128
    capture(np.ones((128, 1)) * 2, 128, None, None)
    render(output, 128, None, None)
    assert np.all(output == 1)
    render(output, 128, None, None)
    assert np.all(output == 2)
    render(output, 128, None, None)
    assert not output.any() and not stream.primed
    assert not restart.is_set()


def test_open_failure_closes_already_opened_input():
    input_stream = Mock()
    sd = SimpleNamespace(InputStream=Mock(return_value=input_stream), OutputStream=Mock(side_effect=RuntimeError("busy")))
    with pytest.raises(RuntimeError, match="busy"):
        monitor.WasapiMonitorStream(sd, dict(samplerate=48000, blocksize=128, channels=(1, 2), device=(1, 2),
                                            extra_settings=(None, None)), Mock(), {}, threading.Event())
    input_stream.close.assert_called_once()


def test_start_failure_aborts_both_endpoints():
    stream, _, _, _ = setup_stream()
    stream.output.start.side_effect = RuntimeError("busy")
    with pytest.raises(RuntimeError, match="busy"):
        stream.start()
    stream.input.abort.assert_called_once()
    stream.output.abort.assert_called_once()
