
from __future__ import annotations

import json
import logging
import os
import threading
import urllib.request

from AI.utils.env import env_flag

_LOG_UPLOAD_URL = os.getenv(
    "KARAOKE_LOG_COLLECTOR_URL",
    "https://karaoke-studio-online.pro100dimka-and.workers.dev/logs",
)
_DISABLED = env_flag("KARAOKE_LOG_COLLECTOR_DISABLED")


def _current_online_name() -> str:
    try:
        from app.services.app_settings_service import read_settings

        return str(read_settings().get("online_name") or "").strip()
    except Exception:
        return ""


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


class RemoteErrorLogHandler(logging.Handler):

    def __init__(self) -> None: super().__init__(level=logging.ERROR)

    def emit(self, record: logging.LogRecord) -> None:
        if _DISABLED: return
        try:
            message = self.format(record)
        except Exception:
            return
        threading.Thread(target=_send, args=(message, _current_online_name()), daemon=True).start()
