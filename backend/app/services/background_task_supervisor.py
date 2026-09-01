from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime


logger = logging.getLogger(__name__)
_lock = threading.RLock()
_accepting = True
_tasks: dict[str, dict[str, object]] = {}


def _timestamp() -> str:
    return datetime.now(UTC).isoformat()


def start_accepting() -> None:
    global _accepting
    with _lock:
        _accepting = True


def stop_accepting() -> None:
    global _accepting
    with _lock:
        _accepting = False


def start_task(
    name: str,
    target: Callable[..., object],
    args: tuple[object, ...] = (),
    *,
    cancel: Callable[[], object] | None = None,
) -> bool:
    with _lock:
        previous = _tasks.get(name)
        if not _accepting or (
            previous is not None
            and isinstance(previous.get("thread"), threading.Thread)
            and previous["thread"].is_alive()
        ):
            return False
        record: dict[str, object] = {
            "name": name,
            "state": "running",
            "error": None,
            "started_at": _timestamp(),
            "finished_at": None,
            "cancel": cancel,
        }

        def run() -> None:
            try:
                target(*args)
            except BaseException as error:
                logger.exception("Background task failed: %s", name)
                with _lock:
                    record["state"] = "error"
                    record["error"] = f"{type(error).__name__}: {error}"[:2000]
            finally:
                with _lock:
                    if record["state"] == "running":
                        record["state"] = "completed"
                    record["finished_at"] = _timestamp()

        thread = threading.Thread(target=run, name=name, daemon=True)
        record["thread"] = thread
        _tasks[name] = record
        try:
            thread.start()
        except BaseException:
            _tasks.pop(name, None)
            raise
        return True


def snapshot() -> dict[str, object]:
    with _lock:
        tasks = [
            {
                "name": record["name"],
                "state": record["state"],
                "error": record["error"],
                "started_at": record["started_at"],
                "finished_at": record["finished_at"],
            }
            for record in _tasks.values()
        ]
        return {"accepting": _accepting, "tasks": tasks}


def shutdown(timeout: float = 10.0) -> dict[str, object]:
    stop_accepting()
    with _lock:
        active = [
            record
            for record in _tasks.values()
            if isinstance(record.get("thread"), threading.Thread)
            and record["thread"].is_alive()
        ]
    for record in active:
        cancel = record.get("cancel")
        if callable(cancel):
            try:
                cancel()
            except Exception:
                logger.exception("Background cancellation failed: %s", record["name"])

    deadline = time.monotonic() + max(0.0, timeout)
    for record in active:
        thread = record["thread"]
        if thread is threading.current_thread():
            continue
        thread.join(timeout=max(0.0, deadline - time.monotonic()))
    lingering = [record["name"] for record in active if record["thread"].is_alive()]
    if lingering:
        logger.error("Background tasks exceeded shutdown deadline: %s", ", ".join(lingering))
    return {
        "requested": len(active),
        "finished": len(active) - len(lingering),
        "lingering": lingering,
    }
