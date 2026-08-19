
from __future__ import annotations

import os

_TRUTHY = {"1", "true", "yes", "on"}


def env_flag(name: str, default: bool = False) -> bool: raw = os.getenv(name); return default if raw is None else raw.strip().lower() in _TRUTHY
