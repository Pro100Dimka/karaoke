from __future__ import annotations

import atexit
import json
import logging
import os
import sys
import threading
import time
import urllib.request
import uuid
from pathlib import Path
from typing import Any

from AI.utils.env import env_flag

_LOG_UPLOAD_URL = os.getenv(
    "KARAOKE_LOG_COLLECTOR_URL",
    "https://karaoke-studio-online.pro100dimka-and.workers.dev/logs",
)


def _running_installed_build() -> bool:
    return bool(getattr(sys, "frozen", False))


# Development already has the local application.log and terminal. Remote R2
# diagnostics are reserved for installed/frozen builds to avoid needless
# Cloudflare requests while running start-dev/start-web.
_DISABLED = env_flag("KARAOKE_LOG_COLLECTOR_DISABLED") or not _running_installed_build()
try:
    _FLUSH_DELAY_SECONDS = max(
        1.0, float(os.getenv("KARAOKE_LOG_FLUSH_DELAY_SECONDS", "30"))
    )
except ValueError:
    _FLUSH_DELAY_SECONDS = 30.0
_CLIENT_USER_AGENT = "A-and-D-Voice/0.3"
_MAX_PENDING_EVENTS = 500
_IDENTITY_LOCK = threading.Lock()
_BUFFER_LOCK = threading.RLock()
_PENDING_EVENTS: list[dict[str, str]] = []
_PENDING_HARDWARE: dict[str, Any] | None = None
_FLUSH_TIMER: threading.Timer | None = None
_RETRY_DELAY_SECONDS = 60.0


def _persistent_device_id() -> str:
    from config import DATA_DIR

    path = Path(DATA_DIR) / "device-id"
    with _IDENTITY_LOCK:
        try:
            value = path.read_text(encoding="utf-8").strip()
            if value: return value
        except OSError:
            pass
        value = f"pc-{uuid.uuid4().hex[:12]}"
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(value, encoding="utf-8")
        except OSError:
            pass
        return value


def _current_online_name() -> str:
    try:
        from app.services.app_settings_service import read_settings

        value = str(read_settings().get("online_name") or "").strip()
        if value and "\ufffd" not in value and value.isprintable(): return value[:80]
    except Exception:
        pass
    return ""


def _send(payload: dict[str, Any]) -> bool:
    try:
        request = urllib.request.Request(
            _LOG_UPLOAD_URL,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": _CLIENT_USER_AGENT},
            method="POST",
        )
        urllib.request.urlopen(request, timeout=10).close()
        return True
    except Exception:
        return False  # Remote diagnostics must never break the application.


def _schedule_flush_locked(delay: float = _FLUSH_DELAY_SECONDS) -> None:
    global _FLUSH_TIMER
    if _FLUSH_TIMER is not None: _FLUSH_TIMER.cancel()
    timer: threading.Timer

    def flush_if_current() -> None:
        with _BUFFER_LOCK:
            if _FLUSH_TIMER is not timer: return
        flush_pending()

    timer = threading.Timer(delay, flush_if_current)
    timer.daemon = True
    _FLUSH_TIMER = timer
    timer.start()


def _take_pending() -> tuple[list[dict[str, str]], dict[str, Any] | None]:
    global _FLUSH_TIMER, _PENDING_HARDWARE
    with _BUFFER_LOCK:
        timer = _FLUSH_TIMER
        events, hardware = list(_PENDING_EVENTS), _PENDING_HARDWARE
        _PENDING_EVENTS.clear()
        _PENDING_HARDWARE = None
        _FLUSH_TIMER = None
        if timer is not None and timer is not threading.current_thread(): timer.cancel()
        return events, hardware


def flush_pending() -> None:
    global _PENDING_HARDWARE, _RETRY_DELAY_SECONDS
    events, hardware = _take_pending()
    if _DISABLED or (not events and hardware is None): return
    payload = {
        "device_id": _persistent_device_id(),
        "display_name": _current_online_name(),
        "events": events,
        **({"hardware": hardware} if hardware is not None else {}),
    }
    if _send(payload):
        _RETRY_DELAY_SECONDS = 60.0
        return
    with _BUFFER_LOCK:
        _PENDING_EVENTS[:0] = events
        del _PENDING_EVENTS[:-_MAX_PENDING_EVENTS]
        if hardware is not None: _PENDING_HARDWARE = hardware
        retry_delay = _RETRY_DELAY_SECONDS
        _RETRY_DELAY_SECONDS = min(3600.0, _RETRY_DELAY_SECONDS * 2.0)
        _schedule_flush_locked(retry_delay)


def queue_hardware_snapshot(hardware: dict[str, Any]) -> None:
    if _DISABLED or not hardware: return
    global _PENDING_HARDWARE
    with _BUFFER_LOCK:
        _PENDING_HARDWARE = hardware
        _schedule_flush_locked()


def queue_log(level: int, message: str) -> None:
    if _DISABLED or level < logging.WARNING or not message.strip(): return
    event = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "level": "ERROR" if level >= logging.ERROR else "WARNING",
        "message": message.strip()[:16_000],
    }
    with _BUFFER_LOCK:
        _PENDING_EVENTS.append(event)
        del _PENDING_EVENTS[:-_MAX_PENDING_EVENTS]
        _schedule_flush_locked()


class RemoteErrorLogHandler(logging.Handler):

    def __init__(self) -> None: super().__init__(level=logging.WARNING)

    def emit(self, record: logging.LogRecord) -> None:
        if _DISABLED or record.levelno < logging.WARNING: return
        try:
            message = self.format(record)
        except Exception:
            return
        queue_log(record.levelno, message)


atexit.register(flush_pending)
