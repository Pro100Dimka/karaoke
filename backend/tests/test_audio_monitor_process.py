import json
import subprocess
import threading
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.services import audio_service


class OutputLines(list):
    def __init__(self, *lines):
        super().__init__(lines)
        self.closed = False

    def close(self):
        self.closed = True


def process(*lines, poll=None):
    return SimpleNamespace(
        stdout=OutputLines(*lines),
        poll=Mock(return_value=poll),
        terminate=Mock(),
        kill=Mock(),
        wait=Mock(),
    )


def test_stop_monitoring_handles_idle_finished_and_running_processes(monkeypatch):
    monkeypatch.setattr(audio_service, "_monitor_process", None)
    monkeypatch.setattr(audio_service, "_monitor_reader", None)
    audio_service.stop_monitoring()

    finished = process(poll=0)
    monkeypatch.setattr(audio_service, "_monitor_process", finished)
    audio_service.stop_monitoring()
    finished.terminate.assert_not_called()

    running = process(poll=None)
    reader = Mock()
    monkeypatch.setattr(audio_service, "_monitor_process", running)
    monkeypatch.setattr(audio_service, "_monitor_reader", reader)
    audio_service.stop_monitoring()
    running.terminate.assert_called_once_with()
    running.wait.assert_called_once_with(timeout=1.5)
    assert running.stdout.closed
    reader.join.assert_called_once_with(timeout=0.5)


def test_stop_monitoring_kills_timeout_and_tolerates_os_error(monkeypatch):
    timed_out = process(poll=None)
    timed_out.wait.side_effect = [subprocess.TimeoutExpired("worker", 1.5), None]
    monkeypatch.setattr(audio_service, "_monitor_process", timed_out)
    monkeypatch.setattr(audio_service, "_monitor_reader", None)
    audio_service.stop_monitoring()
    timed_out.kill.assert_called_once_with()
    assert timed_out.wait.call_count == 2

    failed = process(poll=None)
    failed.terminate.side_effect = OSError("access denied")
    monkeypatch.setattr(audio_service, "_monitor_process", failed)
    audio_service.stop_monitoring()
    assert failed.stdout.closed


def test_frozen_monitor_worker_requires_packaged_binary(monkeypatch, tmp_path):
    worker = tmp_path / "KaraokeAudioMonitor.exe"
    monkeypatch.setattr(audio_service.config, "IS_FROZEN", True)
    monkeypatch.setattr(audio_service.sys, "executable", str(tmp_path / "Backend.exe"))
    with pytest.raises(RuntimeError, match="missing"):
        audio_service._start_monitor_worker({"gain": 1})

    worker.write_bytes(b"worker")
    launch = Mock()
    monkeypatch.setattr(audio_service, "_launch_monitor_process", launch)
    audio_service._start_monitor_worker({"gain": 1})
    command = launch.call_args.args[0]
    assert command[:2] == [str(worker), "--config"]
    assert json.loads(command[-1]) == {"gain": 1}


def test_monitor_process_consumes_started_levels_and_invalid_output(monkeypatch, tmp_path):
    worker = process(
        "not-json\n",
        '{"event":"started"}\n',
        '{"event":"level","rms_db":-8,"clipping":true,"extra":1}\n',
        poll=None,
    )
    monkeypatch.setattr(audio_service.subprocess, "Popen", Mock(return_value=worker))
    monkeypatch.setattr(
        audio_service,
        "_monitor_signal",
        {"rms_db": -120.0, "clipping": False, "silent": True},
    )

    audio_service._launch_monitor_process(["worker"], cwd=tmp_path)

    assert audio_service._monitor_signal == {
        "rms_db": -8,
        "clipping": True,
        "silent": True,
    }


def test_monitor_process_reports_worker_error_and_early_exit(monkeypatch, tmp_path):
    stop = Mock()
    monkeypatch.setattr(audio_service, "stop_monitoring", stop)
    erroring = process('{"event":"error","message":"device busy"}\n', poll=1)
    monkeypatch.setattr(audio_service.subprocess, "Popen", Mock(return_value=erroring))
    with pytest.raises(RuntimeError, match="device busy"):
        audio_service._launch_monitor_process(["worker"], cwd=tmp_path)
    stop.assert_called_once_with()

    stop.reset_mock()
    exited = process(poll=1)
    monkeypatch.setattr(audio_service.subprocess, "Popen", Mock(return_value=exited))
    with pytest.raises(RuntimeError, match="terminated during startup"):
        audio_service._launch_monitor_process(["worker"], cwd=tmp_path)
    stop.assert_called_once_with()


def test_monitor_process_times_out_when_reader_never_signals(monkeypatch, tmp_path):
    worker = process(poll=None)
    monkeypatch.setattr(audio_service.subprocess, "Popen", Mock(return_value=worker))
    event = Mock()
    event.wait.return_value = False
    monkeypatch.setattr(audio_service.threading, "Event", Mock(return_value=event))
    reader = Mock()
    monkeypatch.setattr(audio_service.threading, "Thread", Mock(return_value=reader))
    stop = Mock()
    monkeypatch.setattr(audio_service, "stop_monitoring", stop)

    with pytest.raises(RuntimeError, match="Timed out"):
        audio_service._launch_monitor_process(["worker"], cwd=tmp_path)

    reader.start.assert_called_once_with()
    stop.assert_called_once_with()


def test_stop_monitoring_does_not_join_current_reader(monkeypatch):
    running = process(poll=None)
    current = threading.current_thread()
    monkeypatch.setattr(audio_service, "_monitor_process", running)
    monkeypatch.setattr(audio_service, "_monitor_reader", current)
    audio_service.stop_monitoring()
