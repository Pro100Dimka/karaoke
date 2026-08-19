
import ctypes
import json
import os
import time
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from AI import locks
from tests._shared import patch_attrs, raises


@pytest.mark.parametrize(
    ("failure", "expected"),
    [
        (ProcessLookupError(), False),
        (PermissionError(), True),
        (OSError(), True),
        (None, True),
    ],
)
def test_pid_alive_posix(monkeypatch, failure, expected):
    patch_attrs(monkeypatch, locks.os, name='posix', getpid=lambda: 1)

    def kill(*_):
        if failure: raise failure

    monkeypatch.setattr(locks.os, "kill", kill)
    assert (not locks.FileLock._pid_alive(0)) and (locks.FileLock._pid_alive(1)) and (locks.FileLock._pid_alive(2) is expected)


def kernel32(**values):
    names, result = ['OpenProcess', 'CloseHandle', 'GetExitCodeProcess', 'GetLastError', 'GetProcessTimes'], SimpleNamespace()
    for name in names: setattr(result, name, Mock(**values.get(name, {})))
    return result


def test_pid_alive_windows_states(monkeypatch):
    monkeypatch.setattr(locks.os, "name", "nt")
    kernel = kernel32(OpenProcess={"return_value": 1})

    def exit_code(_handle, pointer):
        pointer._obj.value = 259
        return True

    kernel.GetExitCodeProcess.side_effect = exit_code
    monkeypatch.setattr(ctypes, "windll", SimpleNamespace(kernel32=kernel), raising=False)
    assert locks.FileLock._pid_alive(999)
    kernel.GetExitCodeProcess.side_effect = lambda *_: False
    assert not locks.FileLock._pid_alive(999)
    kernel.OpenProcess.return_value = 0
    kernel.GetLastError.return_value = 5
    assert locks.FileLock._pid_alive(999)
    kernel.GetLastError.return_value = 2
    assert not locks.FileLock._pid_alive(999)
    monkeypatch.setattr(ctypes, "windll", SimpleNamespace(), raising=False)
    assert locks.FileLock._pid_alive(999)


def test_process_birth_windows(monkeypatch):
    monkeypatch.setattr(locks.os, "name", "posix")
    assert locks.FileLock._process_birth(1) is None
    monkeypatch.setattr(locks.os, "name", "nt")
    kernel = kernel32(OpenProcess={"return_value": 0})
    monkeypatch.setattr(ctypes, "windll", SimpleNamespace(kernel32=kernel), raising=False)
    assert locks.FileLock._process_birth(1) is None
    kernel.OpenProcess.return_value = 1
    kernel.GetProcessTimes.return_value = False
    assert locks.FileLock._process_birth(1) is None

    epoch_ticks = 11_644_473_600 * 10_000_000

    def process_times(_handle, creation, *_):
        creation._obj.dwHighDateTime = epoch_ticks >> 32
        creation._obj.dwLowDateTime = epoch_ticks & 0xFFFFFFFF
        return True

    kernel.GetProcessTimes.side_effect = process_times
    assert locks.FileLock._process_birth(1) == 0
    monkeypatch.setattr(ctypes, "windll", SimpleNamespace(), raising=False)
    assert locks.FileLock._process_birth(1) is None


def test_owner_identity_rules(monkeypatch):
    monkeypatch.setattr(locks.FileLock, "_pid_alive", lambda _: False)
    assert (not locks.FileLock._owner_is_alive({'pid': 'bad'})) and (not locks.FileLock._owner_is_alive({'pid': 4}))
    monkeypatch.setattr(locks.FileLock, "_pid_alive", lambda _: True)
    assert locks.FileLock._owner_is_alive({"pid": 4})
    monkeypatch.setattr(locks.FileLock, "_process_birth", lambda _: None)
    assert locks.FileLock._owner_is_alive({"pid": 4, "process_birth": 1})
    monkeypatch.setattr(locks.FileLock, "_process_birth", lambda _: 10)
    assert (locks.FileLock._owner_is_alive({'pid': 4, 'process_birth': 10.5})) and (not locks.FileLock._owner_is_alive({'pid': 4, 'process_birth': 'bad'}))
    monkeypatch.setattr(locks.FileLock, "_pid_alive", lambda pid: pid > 0)
    assert not locks.FileLock._owner_is_alive({"pid": object()})


def test_read_owner_and_remove_stale_files(monkeypatch, tmp_path):
    path = tmp_path / "lock"
    lock = locks.FileLock(path)
    assert lock._read_owner() is None
    path.write_text("[]")
    assert lock._read_owner() is None
    path.write_text(json.dumps({"pid": 1}))
    assert lock._read_owner() == {"pid": 1}
    monkeypatch.setattr(lock, "_owner_is_alive", lambda _: True)
    assert not lock._remove_if_stale() and path.exists()
    monkeypatch.setattr(lock, "_owner_is_alive", lambda _: False)
    assert lock._remove_if_stale() and not path.exists()

    path.write_text("broken")
    assert not lock._remove_if_stale()
    old = time.time() - 20
    os.utime(path, (old, old))
    assert lock._remove_if_stale() and not path.exists()


def test_file_lock_context_and_timeout(tmp_path):
    path = tmp_path / "lock"
    lock = locks.FileLock(path, timeout_sec=0.1, poll_sec=0.001)
    with lock:
        assert path.exists() and lock.fd is not None
        owner = json.loads(path.read_text())
        assert owner["token"] == lock.token
    assert not path.exists() and lock.fd is None

    path.write_text(json.dumps({"pid": os.getpid(), "token": "other"}))
    raises(TimeoutError, lambda: locks.FileLock(path, timeout_sec=0).__enter__(), match='Timed out')
    raises(TimeoutError, lambda: locks.FileLock(path, timeout_sec=0.003, poll_sec=0.001).__enter__())


def test_remove_stale_tolerates_filesystem_races(monkeypatch, tmp_path):
    lock = locks.FileLock(tmp_path / "lock")
    monkeypatch.setattr(lock, "_read_owner", lambda: None)
    lock.path = SimpleNamespace(stat=Mock(side_effect=OSError("gone")))
    assert not lock._remove_if_stale()
    lock.path = SimpleNamespace(
        stat=lambda: SimpleNamespace(st_mtime=0), unlink=Mock(side_effect=OSError("locked"))
    )
    assert not lock._remove_if_stale()
    patch_attrs(monkeypatch, lock, _read_owner=lambda: {'pid': 1}, _owner_is_alive=lambda _: False)
    assert not lock._remove_if_stale()


def test_file_lock_does_not_remove_new_owner_on_exit(tmp_path):
    path = tmp_path / "lock"
    lock = locks.FileLock(path)
    lock.__enter__()
    path.write_text(json.dumps({"pid": os.getpid(), "token": "replacement"}))
    lock.__exit__(None, None, None)
    assert path.exists()


def test_thread_file_lock_context_and_reference_cleanup(tmp_path):
    path = tmp_path / "lock"
    first = locks.ThreadFileLock(path)
    with first:
        assert first.key in locks.ThreadFileLock._entries
    assert first.key not in locks.ThreadFileLock._entries
    first._release_ref()


def test_thread_file_lock_timeout_and_file_failure(monkeypatch, tmp_path):
    path = tmp_path / "lock"
    key, held = str(path.resolve()), locks.threading.Lock()
    held.acquire()
    locks.ThreadFileLock._entries[key] = (held, 0)
    try:
        raises(TimeoutError, lambda: locks.ThreadFileLock(path, timeout_sec=0).__enter__(), match='in-process')
    finally:
        held.release()
        locks.ThreadFileLock._entries.pop(key, None)

    broken = Mock()
    broken.__enter__ = Mock(side_effect=RuntimeError("file lock"))
    monkeypatch.setattr(locks, "FileLock", Mock(return_value=broken))
    raises(RuntimeError, lambda: locks.ThreadFileLock(path).__enter__(), match='file lock')
    assert key not in locks.ThreadFileLock._entries
