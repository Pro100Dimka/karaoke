
from __future__ import annotations

from typing import Any

_cache: dict[str, tuple[tuple[object, ...], str]] = {}


def get(song_id: Any, signature: tuple[object, ...]) -> str | None:
    cached = _cache.get(str(song_id))
    return cached[1] if cached is not None and cached[0] == signature else None


def put(song_id: Any, signature: tuple[object, ...], revision: str) -> None:
    _cache[str(song_id)] = (signature, revision)


def invalidate(song_or_id: Any) -> None:
    song_id = getattr(song_or_id, "id", song_or_id)
    _cache.pop(str(song_id), None)


def clear() -> None: _cache.clear()
