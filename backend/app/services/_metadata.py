
from __future__ import annotations


def first_audio_tag(tags: object, *names: str) -> str | None:
    if not callable(get := getattr(tags, "get", None)): return None
    for name in names:
        value = get(name)
        if isinstance(value, (list, tuple)): value = next((item for item in value if isinstance(item, str) and item.strip()), None)
        if isinstance(value, str) and value.strip(): return value.strip()
    return None
