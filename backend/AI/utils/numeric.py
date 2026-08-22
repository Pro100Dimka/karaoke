from typing import TypeVar

Number = TypeVar("Number", int, float)


def clamp(value: Number, low: Number, high: Number) -> Number:
    return max(low, min(high, value))


def clamp01(value: float) -> float:
    return clamp(value, 0.0, 1.0)


def int_or(value, default=None):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def float_or(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def energy_attack_strength(before, after, *, threshold=1.25, scale=0.9) -> float:
    return clamp01((float(after) / max(float(before), 1e-9) - threshold) / scale)
