from __future__ import annotations

import unicodedata

WINDOWS_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}


def normalize_windows_component(
    value: str,
    *,
    fallback: str | None = None,
    reject_reserved: bool = False,
) -> str:
    """Apply the shared Windows filename-component normalization rule."""
    normalized = unicodedata.normalize("NFKC", str(value)).rstrip(" .")
    if not normalized:
        if fallback is None: raise ValueError("Windows path component is empty")
        return fallback
    stem = normalized.split(".", 1)[0].rstrip(" .").upper()
    if stem in WINDOWS_RESERVED_NAMES:
        if reject_reserved: raise ValueError("Windows path component uses a reserved name")
        normalized = f"_{normalized}"
    return normalized
