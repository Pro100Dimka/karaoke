"""Identity metadata compatibility for legacy KAR/MIDI authoring tools."""

from __future__ import annotations

import re
from typing import Any

_GENERIC_TRACK_NAMES = {
    "words", "lyrics", "vocal", "vocals", "melody", "untitled", "track",
}


def _clean(value: Any) -> str:
    return " ".join(str(value or "").replace("\x00", "").split())


def contains_hint(text: str, hints: tuple[str, ...]) -> bool:
    return any(re.search(rf"(?<!\w){re.escape(hint)}(?!\w)", text) for hint in hints)


def metadata(tracks: list[list[tuple[int, Any]]]) -> tuple[str, str, str]:
    tagged, header, key = [], [], "Unknown"
    for track_index, track in enumerate(tracks):
        for _tick, message in track:
            if message.type == "key_signature" and key == "Unknown":
                key = str(message.key)
            if track_index == 0 and message.type == "track_name":
                value = _clean(getattr(message, "name", ""))
                if value and value.casefold() not in _GENERIC_TRACK_NAMES and value not in header:
                    header.append(value)
            if message.type in {"text", "lyrics"}:
                text = str(getattr(message, "text", "")).strip()
                if text.upper().startswith("@T") and (value := _clean(text[2:])):
                    tagged.append(value)
    values = tagged or header[:2]
    title, artist = values[0] if values else "", values[1] if len(values) > 1 else ""
    composite = re.match(r"^(.+?)\s+[-–—]\s+(.+)$", title)
    if composite:
        title, artist = _clean(composite.group(1)), _clean(composite.group(2))
    return title, artist, key
