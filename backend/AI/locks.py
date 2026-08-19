from __future__ import annotations

import json
import os
import secrets
import threading
import time
from contextlib import AbstractContextManager, suppress
from pathlib import Path


def _windows_process_api():
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.windll.kernel32
    kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    kernel32.CloseHandle.restype = wintypes.BOOL
    return ctypes, wintypes, kernel32


class FileLock(AbstractContextManager):

    def __init__(self, path: str | Path, *, timeout_sec: float = 30.0, poll_sec: float = 0.05):
        self.path = Path(path)
        self.timeout_sec = float(timeout_sec)
        self.poll_sec = float(poll_sec)
        self.token = secrets.token_hex(16)
        self.fd: int | None = None

    @staticmethod
    def _pid_alive(pid: int) -> bool:
        if pid <= 0: return False
        if pid == os.getpid(): return True
        if os.name == "nt":
            try:
                ctypes, wintypes, kernel32 = _windows_process_api()
                process_query_limited_information = 0x1000
                kernel32.GetExitCodeProcess.argtypes = (
                    wintypes.HANDLE,
                    ctypes.POINTER(wintypes.DWORD),
                )
                kernel32.GetExitCodeProcess.restype = wintypes.BOOL
                handle = kernel32.OpenProcess(process_query_limited_information, False, pid)
                if handle:
                    exit_code = wintypes.DWORD()
                    try:
                        queried = kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code))
                    finally:
                        kernel32.CloseHandle(handle)
                    return bool(queried and exit_code.value == 259)
                error = kernel32.GetLastError()
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

    @staticmethod
    def _process_birth(pid: int) -> float | None:
        if pid <= 0 or os.name != "nt": return None
        try:
            ctypes, wintypes, kernel32 = _windows_process_api()
            process_query_limited_information = 0x1000
            handle = kernel32.OpenProcess(process_query_limited_information, False, pid)
            if not handle: return None
            creation = wintypes.FILETIME()
            exit_time = wintypes.FILETIME()
            kernel = wintypes.FILETIME()
            user = wintypes.FILETIME()
            try:
                kernel32.GetProcessTimes.argtypes = (
                    wintypes.HANDLE,
                    ctypes.POINTER(wintypes.FILETIME),
                    ctypes.POINTER(wintypes.FILETIME),
                    ctypes.POINTER(wintypes.FILETIME),
                    ctypes.POINTER(wintypes.FILETIME),
                )
                kernel32.GetProcessTimes.restype = wintypes.BOOL
                if not kernel32.GetProcessTimes(
                    handle,
                    ctypes.byref(creation),
                    ctypes.byref(exit_time),
                    ctypes.byref(kernel),
                    ctypes.byref(user),
                ):
                    return None
            finally:
                kernel32.CloseHandle(handle)
            ticks = (creation.dwHighDateTime << 32) | creation.dwLowDateTime
            return ticks / 10_000_000 - 11_644_473_600
        except (AttributeError, OSError, TypeError, ValueError):
            return None

    @classmethod
    def _owner_is_alive(cls, owner: dict[str, object]) -> bool:
        try:
            raw_pid = owner.get("pid", -1)
            pid = int(raw_pid) if isinstance(raw_pid, (str, int, float)) else -1
        except (TypeError, ValueError):
            return False
        if not cls._pid_alive(pid): return False
        recorded_birth = owner.get("process_birth")
        if not isinstance(recorded_birth, (str, int, float)):
            return True  # Compatibility with locks created by older versions.
        actual_birth = cls._process_birth(pid)
        if actual_birth is None:
            return True  # Never break a lock merely because querying was denied.
        try:
            return abs(actual_birth - float(recorded_birth)) < 1.0
        except (TypeError, ValueError):
            return False

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
            try:
                if time.time() - self.path.stat().st_mtime < 10.0: return False
            except OSError:
                return False
            try:
                self.path.unlink()
                return True
            except OSError:
                return False
        if self._owner_is_alive(owner): return False
        try:
            self.path.unlink()
            return True
        except OSError:
            return False

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        deadline, pid = time.monotonic() + self.timeout_sec, os.getpid()
        payload = json.dumps(
            {
                "pid": pid,
                "token": self.token,
                "created": time.time(),
                "process_birth": self._process_birth(pid),
            },
            separators=(",", ":"),
        ).encode("utf-8")
        while True:
            try:
                self.fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(self.fd, payload)
                os.fsync(self.fd)
                return self
            except FileExistsError as exc:
                self._remove_if_stale()
                if time.monotonic() >= deadline: raise TimeoutError(f"Timed out waiting for lock: {self.path}") from exc
                time.sleep(self.poll_sec)

    def __exit__(self, exc_type, exc, tb):
        if self.fd is not None:
            try:
                os.close(self.fd)
            finally:
                self.fd = None
        owner = self._read_owner()
        if owner and owner.get("token") == self.token:
            with suppress(FileNotFoundError): self.path.unlink()
        return False


class ThreadFileLock(AbstractContextManager):

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
            if current is None: return
            lock, refs = current
            if refs <= 1 and not lock.locked():
                self._entries.pop(self.key, None)
            else:
                self._entries[self.key] = (lock, max(0, refs - 1))

    def __exit__(self, exc_type, exc, tb):
        try:
            if self.file_lock is not None: self.file_lock.__exit__(exc_type, exc, tb)
        finally:
            if self.thread_lock is not None: self.thread_lock.release()
            self._release_ref()
        return False
