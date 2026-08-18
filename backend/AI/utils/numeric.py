"""Shared numeric clamping used across the AI core and app services.

``max(low, min(high, value))`` was independently re-typed at ~50 call sites
across pitch/text/note scoring and a handful of app-layer settings -- always
verbatim identical for the [0.0, 1.0] confidence/score case. Factoring it out
changes nothing about NaN or infinity handling: this is the exact same
expression, just named.
"""

from __future__ import annotations

from typing import TypeVar

_Number = TypeVar("_Number", int, float)


def clamp(value: _Number, low: _Number, high: _Number) -> _Number:
    """Clamp *value* into [low, high] using the project's max(low, min(high, value)) idiom."""
    return max(low, min(high, value))


def clamp01(value: float) -> float:
    """Clamp *value* into the unit interval [0.0, 1.0] used throughout confidence/score scoring."""
    return max(0.0, min(1.0, value))
