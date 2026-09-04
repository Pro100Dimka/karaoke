from __future__ import annotations

import threading

from app.services import background_task_supervisor as supervisor


def test_supervisor_tracks_completion_and_rejects_new_work_after_shutdown(monkeypatch):
    monkeypatch.setattr(supervisor, "_tasks", {})
    monkeypatch.setattr(supervisor, "_accepting", True)
    started, release = threading.Event(), threading.Event()

    def worker():
        started.set()
        release.wait()

    assert supervisor.start_task("job", worker, cancel=release.set) is True
    assert started.wait(timeout=1.0)
    result = supervisor.shutdown(timeout=1.0)

    assert release.is_set()
    assert result == {"requested": 1, "finished": 1, "lingering": []}
    snapshot = supervisor.snapshot()
    assert snapshot["accepting"] is False
    assert snapshot["tasks"][0]["state"] == "completed"
    assert snapshot["tasks"][0]["finished_at"] is not None
    assert supervisor.start_task("new", lambda: None) is False


def test_supervisor_records_worker_errors(monkeypatch):
    monkeypatch.setattr(supervisor, "_tasks", {})
    monkeypatch.setattr(supervisor, "_accepting", True)

    def fail():
        raise RuntimeError("broken worker")

    assert supervisor.start_task("broken", fail) is True
    assert supervisor.shutdown(timeout=1.0)["lingering"] == []
    task = supervisor.snapshot()["tasks"][0]
    assert task["state"] == "error"
    assert task["error"] == "RuntimeError: broken worker"
