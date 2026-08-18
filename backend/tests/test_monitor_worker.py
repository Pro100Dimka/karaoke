import contextlib
import json
import runpy
import sys
import threading
from unittest.mock import Mock

import numpy as np
import pytest

from app.services import monitor_worker


def options():
    return {
        "sample_rate": 48_000,
        "output_channels": 2,
        "input_device_id": 1,
        "output_device_id": 2,
        "blocksize": 64,
        "gain": 2,
        "wasapi_exclusive": False,
    }


def configure_argv(monkeypatch, config=None):
    monkeypatch.setattr(
        sys,
        "argv",
        ["monitor_worker", "--config", json.dumps(config or options())],
    )


def test_emit_and_stop_update_process_contract(monkeypatch, capsys):
    monitor_worker._emit({"event": "started"})
    assert json.loads(capsys.readouterr().out) == {"event": "started"}
    monkeypatch.setattr(monitor_worker, "_running", True)
    monitor_worker._stop(0, None)
    assert monitor_worker._running is False


def test_read_live_updates_applies_json_lines_and_ignores_bad_input(monkeypatch):
    monkeypatch.setattr(monitor_worker, "_live_params", {"reverb": 0.0, "echo": 0.0, "delay": 0.0})
    lines = iter(["not-json\n", "\n", '{"reverb": 0.4}\n', '{"echo": 0.2, "delay": 0.1}\n'])
    monkeypatch.setattr(sys, "stdin", lines)
    monitor_worker._read_live_updates()
    assert monitor_worker._live_params == {"reverb": 0.4, "echo": 0.2, "delay": 0.1}


def test_audio_callback_reads_current_live_effect_parameters(monkeypatch):
    monkeypatch.setattr(monitor_worker, "_live_params", {"reverb": 0.3, "echo": 0.4, "delay": 0.5})
    captured = {}

    class FakeChain:
        def __init__(self, sample_rate):
            pass

        def process(self, samples, reverb, echo, delay):
            captured["params"] = (reverb, echo, delay)
            return samples

    monkeypatch.setattr(monitor_worker, "MonitorEffectsChain", FakeChain)
    callback = monitor_worker._audio_callback(1.0, monitor_worker.threading.Event(), [], sample_rate=48_000)
    indata = np.zeros((4, 1), dtype=np.float32)
    outdata = np.zeros((4, 2), dtype=np.float32)
    callback(indata, outdata, 4, None, None)
    assert captured["params"] == (0.3, 0.4, 0.5)


def test_main_seeds_live_params_from_config_and_starts_reader_thread(monkeypatch, capsys):
    configure_argv(monkeypatch, {**options(), "reverb": 0.2, "echo": 0.5, "delay": 0.7})
    monkeypatch.setattr(monitor_worker, "_running", False)
    monkeypatch.setattr(monitor_worker, "_live_params", {"reverb": 0.0, "echo": 0.0, "delay": 0.0})
    thread_started = threading.Event()
    real_thread_init = monitor_worker.threading.Thread.__init__

    def watched_init(self, *args, **kwargs):
        if kwargs.get("target") is monitor_worker._read_live_updates:
            thread_started.set()
            assert kwargs.get("daemon") is True
        real_thread_init(self, *args, **kwargs)

    monkeypatch.setattr(monitor_worker.threading.Thread, "__init__", watched_init)
    # Stdin here is pytest's captured input; the reader thread must not block
    # or crash main() when it hits that (_read_live_updates swallows errors).
    stream = Mock()
    monkeypatch.setattr(monitor_worker.sd, "Stream", Mock(return_value=stream))

    assert monitor_worker.main() == 0
    assert monitor_worker._live_params == {"reverb": 0.2, "echo": 0.5, "delay": 0.7}
    assert thread_started.is_set()
    capsys.readouterr()


def test_main_starts_and_stops_first_candidate(monkeypatch, capsys):
    configure_argv(monkeypatch)
    monkeypatch.setattr(monitor_worker, "_running", False)
    stream = Mock()
    monkeypatch.setattr(monitor_worker.sd, "Stream", Mock(return_value=stream))

    assert monitor_worker.main() == 0
    events = [json.loads(line)["event"] for line in capsys.readouterr().out.splitlines()]
    assert events == ["started"]
    stream.start.assert_called_once_with()
    stream.abort.assert_called_once_with()
    stream.close.assert_called_once_with()


def test_main_reports_fallback_after_driver_rejection(monkeypatch, capsys):
    configure_argv(monkeypatch)
    monkeypatch.setattr(monitor_worker, "_running", False)
    failed = Mock()
    failed.start.side_effect = RuntimeError("exclusive rejected")
    fallback = Mock()
    monkeypatch.setattr(monitor_worker.sd, "Stream", Mock(side_effect=[failed, fallback]))
    monkeypatch.setattr(
        monitor_worker,
        "_stream_candidates",
        Mock(return_value=[{"blocksize": 64}, {"blocksize": 128}]),
    )

    assert monitor_worker.main() == 0
    events = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert [event["event"] for event in events] == ["fallback", "started"]
    assert events[0]["message"] == "exclusive rejected"
    failed.abort.assert_called_once_with()
    failed.close.assert_called_once_with()


def test_main_emits_error_when_all_candidates_fail(monkeypatch, capsys):
    configure_argv(monkeypatch)
    monkeypatch.setattr(monitor_worker, "_running", True)
    broken = Mock()
    broken.start.side_effect = RuntimeError("device busy")
    broken.abort.side_effect = RuntimeError("abort failed")
    monkeypatch.setattr(monitor_worker.sd, "Stream", Mock(return_value=broken))
    monkeypatch.setattr(
        monitor_worker,
        "_stream_candidates",
        Mock(return_value=[{"blocksize": 64}]),
    )

    assert monitor_worker.main() == 1
    assert json.loads(capsys.readouterr().out)["message"] == "device busy"


def test_callback_updates_levels_and_requests_restart_after_glitches(monkeypatch, capsys):
    configure_argv(monkeypatch)
    monkeypatch.setattr(monitor_worker, "_running", False)
    monkeypatch.setattr(
        monitor_worker.time,
        "monotonic",
        Mock(side_effect=[1.0, 1.5, 2.0, 4.5]),
    )
    stream = Mock()

    def start():
        callback = monitor_worker.sd.Stream.call_args.kwargs["callback"]
        input_data = np.array([[0.6], [-0.6]], dtype=np.float32)
        output = np.empty((2, 2), dtype=np.float32)
        callback(input_data, output, 2, None, "glitch")
        callback(input_data, output, 2, None, "glitch")
        callback(input_data, output, 2, None, "glitch")
        callback(input_data, output, 2, None, "glitch")
        assert np.max(np.abs(output)) <= 0.985
        assert np.allclose(output[:, 0], output[:, 1])

    stream.start.side_effect = start
    monkeypatch.setattr(monitor_worker.sd, "Stream", Mock(return_value=stream))
    assert monitor_worker.main() == 0
    assert monitor_worker._level["rms_db"] > -20
    assert monitor_worker._level["clipping"] is False
    assert monitor_worker._level["silent"] is False
    capsys.readouterr()


def test_main_emits_level_while_running(monkeypatch, capsys):
    configure_argv(monkeypatch)
    monkeypatch.setattr(monitor_worker, "_running", True)

    class Event:
        def clear(self):
            pass

        def set(self):
            pass

        def wait(self, _timeout):
            monitor_worker._running = False
            return False

    monkeypatch.setattr(monitor_worker.threading, "Event", Event)
    # The live-update reader thread is unrelated to this test's control of the
    # stream loop; a real Thread would construct a real Event internally and
    # collide with the fake Event class patched above.
    monkeypatch.setattr(monitor_worker.threading, "Thread", Mock())
    stream = Mock()
    monkeypatch.setattr(monitor_worker.sd, "Stream", Mock(return_value=stream))
    assert monitor_worker.main() == 0
    events = [json.loads(line)["event"] for line in capsys.readouterr().out.splitlines()]
    assert events == ["started", "level"]


def test_main_finalizer_suppresses_stream_cleanup_failure(monkeypatch, capsys):
    configure_argv(monkeypatch)
    monkeypatch.setattr(monitor_worker, "_running", True)
    stream = Mock()
    stream.start.side_effect = KeyboardInterrupt()
    stream.close.side_effect = RuntimeError("cleanup failed")
    monkeypatch.setattr(monitor_worker.sd, "Stream", Mock(return_value=stream))
    with contextlib.suppress(KeyboardInterrupt):
        monitor_worker.main()
    capsys.readouterr()


def test_script_entrypoint_registers_signals_and_exits(monkeypatch, tmp_path, capsys):
    configure_argv(monkeypatch)
    stream = Mock()

    def create_stream(**kwargs):
        def start():
            kwargs["callback"].__globals__["_running"] = False

        stream.start.side_effect = start
        return stream

    monkeypatch.setattr(monitor_worker.sd, "Stream", create_stream)
    monkeypatch.setitem(__import__("sys").modules, "sounddevice", monitor_worker.sd)
    register = Mock()
    monkeypatch.setattr(monitor_worker.signal, "signal", register)
    with pytest.raises(SystemExit) as stopped:
        runpy.run_path(monitor_worker.__file__, run_name="__main__")
    assert stopped.value.code == 0
    assert register.call_count >= 1
    capsys.readouterr()
