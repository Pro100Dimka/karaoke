from __future__ import annotations

from contextlib import AbstractContextManager
import json
import os
from pathlib import Path
import secrets
import threading
import time


class FileLock(AbstractContextManager):
    """Small cross-process lock based on exclusive file creation.

    Ownership is token-based, so a process never removes a lock recreated by another
    process. A lock is considered stale only when its owning PID is not alive.
    """

    def __init__(self, path: str | Path, *, timeout_sec: float = 30.0, poll_sec: float = 0.05):
        self.path = Path(path)
        self.timeout_sec = float(timeout_sec)
        self.poll_sec = float(poll_sec)
        self.token = secrets.token_hex(16)
        self.fd: int | None = None

    @staticmethod
    def _pid_alive(pid: int) -> bool:
        if pid <= 0:
            return False
        if pid == os.getpid():
            return True
        if os.name == "nt":
            try:
                import ctypes

                process_query_limited_information = 0x1000
                handle = ctypes.windll.kernel32.OpenProcess(
                    process_query_limited_information, False, pid
                )
                if handle:
                    ctypes.windll.kernel32.CloseHandle(handle)
                    return True
                error = ctypes.windll.kernel32.GetLastError()
                return error == 5  # Access denied means the process exists.
            except (AttributeError, OSError):
                return True
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        except OSError:
            return True
        return True

    def _read_owner(self) -> dict[str, object] | None:
        try:
            raw = self.path.read_text(encoding="utf-8")
            value = json.loads(raw)
            return value if isinstance(value, dict) else None
        except (OSError, UnicodeError, json.JSONDecodeError):
            return None

    def _remove_if_stale(self) -> bool:
        owner = self._read_owner()
        if owner is None:
            # Do not delete a recently-created, partially-written lock.
            try:
                if time.time() - self.path.stat().st_mtime < 10.0:
                    return False
            except OSError:
                return False
            try:
                self.path.unlink()
                return True
            except OSError:
                return False
        try:
            pid = int(owner.get("pid", -1))
        except (TypeError, ValueError):
            pid = -1
        if self._pid_alive(pid):
            return False
        try:
            self.path.unlink()
            return True
        except OSError:
            return False

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        deadline = time.monotonic() + self.timeout_sec
        payload = json.dumps(
            {"pid": os.getpid(), "token": self.token, "created": time.time()},
            separators=(",", ":"),
        ).encode("utf-8")
        while True:
            try:
                self.fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(self.fd, payload)
                os.fsync(self.fd)
                return self
            except FileExistsError:
                self._remove_if_stale()
                if time.monotonic() >= deadline:
                    raise TimeoutError(f"Timed out waiting for lock: {self.path}")
                time.sleep(self.poll_sec)

    def __exit__(self, exc_type, exc, tb):
        if self.fd is not None:
            try:
                os.close(self.fd)
            finally:
                self.fd = None
        owner = self._read_owner()
        if owner and owner.get("token") == self.token:
            try:
                self.path.unlink()
            except FileNotFoundError:
                pass
        return False


class ThreadFileLock(AbstractContextManager):
    """Combines an in-process lock with FileLock without leaking lock objects."""

    _guard = threading.Lock()
    _entries: dict[str, tuple[threading.Lock, int]] = {}

    def __init__(self, path: str | Path, *, timeout_sec: float = 30.0):
        self.path = Path(path)
        self.timeout_sec = timeout_sec
        self.key = str(self.path.resolve())
        self.thread_lock: threading.Lock | None = None
        self.file_lock: FileLock | None = None

    def __enter__(self):
        with self._guard:
            lock, refs = self._entries.get(self.key, (threading.Lock(), 0))
            self._entries[self.key] = (lock, refs + 1)
            self.thread_lock = lock
        if not self.thread_lock.acquire(timeout=self.timeout_sec):
            self._release_ref()
            raise TimeoutError(f"Timed out waiting for in-process lock: {self.path}")
        try:
            self.file_lock = FileLock(self.path, timeout_sec=self.timeout_sec)
            self.file_lock.__enter__()
            return self
        except BaseException:
            self.thread_lock.release()
            self._release_ref()
            raise

    def _release_ref(self) -> None:
        with self._guard:
            current = self._entries.get(self.key)
            if current is None:
                return
            lock, refs = current
            if refs <= 1 and not lock.locked():
                self._entries.pop(self.key, None)
            else:
                self._entries[self.key] = (lock, max(0, refs - 1))

    def __exit__(self, exc_type, exc, tb):
        try:
            if self.file_lock is not None:
                self.file_lock.__exit__(exc_type, exc, tb)
        finally:
            if self.thread_lock is not None:
                self.thread_lock.release()
            self._release_ref()
        return False
