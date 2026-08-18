"""Shared truthy/falsy environment variable parsing.

Every call site across the AI core and the app layer that reads an opt-in or
opt-out flag from the environment has historically re-implemented the same
``{"1", "true", "yes", "on"}`` vocabulary inline. This is the single place
that contract lives now.
"""

from __future__ import annotations

import os

_TRUTHY = {"1", "true", "yes", "on"}


def env_flag(name: str, default: bool = False) -> bool:
    """Parse a boolean environment variable using the shared on/off vocabulary.

    Returns *default* when the variable is unset. Any set value is matched
    case-insensitively (after stripping whitespace) against ``1/true/yes/on``;
    anything else -- including ``"0"``, ``"false"`` or garbage -- is falsy.
    """
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in _TRUTHY
