"""Per-request correlation id, so one failed call can be traced from the
frontend's error message back to the exact backend log line that raised it.
"""

from __future__ import annotations

import contextvars
import uuid

_current: contextvars.ContextVar[str | None] = contextvars.ContextVar("correlation_id", default=None)


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def set_current(correlation_id: str) -> None:
    _current.set(correlation_id)


def get_current() -> str | None:
    return _current.get()
