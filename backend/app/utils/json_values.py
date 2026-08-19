"""Safe parsing helpers for JSON values persisted in database text columns."""

from __future__ import annotations

import json
from typing import Any, TypeVar

T = TypeVar("T")


def parse_json_value(value: str | None, default: T) -> Any | T:
    """Parse a JSON text value and return *default* when it is missing or corrupt."""
    if not value: return default
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default
