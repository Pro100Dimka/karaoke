
from __future__ import annotations

import json
import logging
import os
import threading
import urllib.request
import uuid
from pathlib import Path

from AI.utils.env import env_flag

_LOG_UPLOAD_URL = os.getenv(
    "KARAOKE_LOG_COLLECTOR_URL",
    "https://karaoke-studio-online.pro100dimka-and.workers.dev/logs",
)
_DISABLED = env_flag("KARAOKE_LOG_COLLECTOR_DISABLED")
_IDENTITY_LOCK = threading.Lock()


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

        return str(read_settings().get("online_name") or "").strip() or _persistent_device_id()
    except Exception:
        return _persistent_device_id()


def _send(message: str, user: str) -> None:
    try:
        payload = json.dumps({"message": message, "user": user}).encode("utf-8")
        request = urllib.request.Request(
            _LOG_UPLOAD_URL,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(request, timeout=5).close()
    except Exception:
        pass  # Diagnostics must never raise into the caller.


def send_diagnostic(message: str) -> None:
    if _DISABLED or not message.strip(): return
    threading.Thread(target=_send, args=(message, _current_online_name()), daemon=True).start()


class RemoteErrorLogHandler(logging.Handler):

    def __init__(self) -> None: super().__init__(level=logging.WARNING)

    def emit(self, record: logging.LogRecord) -> None:
        if _DISABLED: return
        try:
            message = self.format(record)
        except Exception:
            return
        send_diagnostic(message)
