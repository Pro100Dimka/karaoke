from __future__ import annotations

import json
import os
from pathlib import Path

from AI.locks import FileLock


def test_lock_reclaims_reused_pid(tmp_path: Path, monkeypatch) -> None:
    path = tmp_path / ".pipeline.lock"
    path.write_text(
        json.dumps({"pid": 42, "token": "old", "process_birth": 100.0}),
        encoding="utf-8",
    )
    monkeypatch.setattr(FileLock, "_pid_alive", staticmethod(lambda _pid: True))
    monkeypatch.setattr(FileLock, "_process_birth", staticmethod(lambda _pid: 200.0))

    with FileLock(path, timeout_sec=0.1):
        owner = json.loads(path.read_text(encoding="utf-8"))
        assert owner["pid"] == os.getpid()
        assert owner["token"] != "old"


def test_lock_keeps_matching_live_owner(tmp_path: Path, monkeypatch) -> None:
    path = tmp_path / ".pipeline.lock"
    path.write_text(
        json.dumps({"pid": 42, "token": "active", "process_birth": 100.0}),
        encoding="utf-8",
    )
    monkeypatch.setattr(FileLock, "_pid_alive", staticmethod(lambda _pid: True))
    monkeypatch.setattr(FileLock, "_process_birth", staticmethod(lambda _pid: 100.0))

    assert FileLock(path, timeout_sec=0.01)._remove_if_stale() is False
    assert path.exists()


def test_current_process_is_reported_alive() -> None:
    assert FileLock._pid_alive(os.getpid()) is True
