
from __future__ import annotations

import statistics
from typing import TypeVar

_Number = TypeVar("_Number", int, float)


def clamp(value: _Number, low: _Number, high: _Number) -> _Number: return max(low, min(high, value))


def clamp01(value: float) -> float: return max(0.0, min(1.0, value))


def _number_or(cast, value, default):
    try:
        return cast(value)
    except (TypeError, ValueError):
        return default


def int_or(value, default=None): return _number_or(int, value, default)


def float_or(value, default=0.0): return _number_or(float, value, default)


def energy_attack_strength(before, after, *, threshold=1.25, scale=0.9) -> float:
    if not before or not after: return 0.0
    baseline, current = statistics.median(before), max(after)
    if baseline <= 1e-8: return 1.0 if current > 1e-5 else 0.0
    return clamp01((current / baseline - threshold) / scale)
