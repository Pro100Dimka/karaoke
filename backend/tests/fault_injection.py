"""Reusable, deterministic fault-injection helpers for tests (TASK 44.3).

Each helper patches exactly one narrow surface via ``monkeypatch`` and knows
nothing about specific business logic -- compose them with whatever code path
a test is already exercising. All of them are undone automatically by
pytest's own monkeypatch teardown, same as any other ``monkeypatch.setattr``.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from pathlib import Path
from typing import Any


def fail_write(monkeypatch, *, error: Exception | None = None) -> None:
    """Make every subsequent ``Path.open(..., "w"/"a"/"x")`` raise ``error``."""
    failure = error or OSError("simulated write failure")
    original_open = Path.open

    def broken_open(self: Path, mode: str = "r", *args: Any, **kwargs: Any):
        if any(flag in mode for flag in ("w", "a", "x", "+")):
            raise failure
        return original_open(self, mode, *args, **kwargs)

    monkeypatch.setattr(Path, "open", broken_open)


def fail_rename(monkeypatch, *, error: Exception | None = None) -> None:
    """Make ``Path.rename``/``Path.replace`` raise ``error`` (a failed atomic move)."""
    failure = error or OSError("simulated rename failure")

    def broken(self: Path, target: Any) -> Path:
        raise failure

    monkeypatch.setattr(Path, "rename", broken)
    monkeypatch.setattr(Path, "replace", broken)


def delay_operation(monkeypatch, target: object, attribute: str, seconds: float) -> None:
    """Make calling ``target.attribute(...)`` sleep ``seconds`` before running."""
    original = getattr(target, attribute)

    def delayed(*args: Any, **kwargs: Any):
        time.sleep(seconds)
        return original(*args, **kwargs)

    monkeypatch.setattr(target, attribute, delayed)


def kill_child(monkeypatch, target: object, attribute: str, *, returncode: int = -9) -> None:
    """Make calling ``target.attribute(...)`` return a process-like object that
    reports as already dead with the given (negative-signal) return code."""

    class DeadProcess:
        def __init__(self) -> None:
            self.returncode = returncode
            self.stdout = self.stdin = None

        def poll(self) -> int:
            return self.returncode

        def wait(self, timeout: float | None = None) -> int:
            return self.returncode

        def terminate(self) -> None:
            return None

        def kill(self) -> None:
            return None

    monkeypatch.setattr(target, attribute, lambda *args, **kwargs: DeadProcess())


def return_corrupt_data(monkeypatch, target: object, attribute: str, corrupt: Any) -> None:
    """Make calling ``target.attribute(...)`` unconditionally return ``corrupt``."""
    monkeypatch.setattr(target, attribute, lambda *args, **kwargs: corrupt)


def simulate_oom(monkeypatch, target: object, attribute: str) -> None:
    """Make calling ``target.attribute(...)`` raise ``MemoryError``."""

    def raise_oom(*args: Any, **kwargs: Any):
        raise MemoryError("simulated out of memory")

    monkeypatch.setattr(target, attribute, raise_oom)


def simulate_device_loss(monkeypatch, target: object, attribute: str, *, error: Exception | None = None) -> None:
    """Make calling ``target.attribute(...)`` raise as if the audio/IO device vanished."""
    failure = error or OSError("simulated device disconnect")

    def raise_disconnect(*args: Any, **kwargs: Any):
        raise failure

    monkeypatch.setattr(target, attribute, raise_disconnect)


def call_n_times_then(calls: list[Callable[[], Any]]) -> Callable[..., Any]:
    """Return a callable that runs ``calls[0]`` on the first invocation, ``calls[1]``
    on the second, and so on -- useful for "succeeds on retry N" fault scenarios."""
    state = {"index": 0}

    def run(*args: Any, **kwargs: Any):
        index = min(state["index"], len(calls) - 1)
        state["index"] += 1
        return calls[index]()

    return run
