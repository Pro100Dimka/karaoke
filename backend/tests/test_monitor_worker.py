import contextlib
import json
import runpy
import sys
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
