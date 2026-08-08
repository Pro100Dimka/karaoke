from __future__ import annotations

import re
from pathlib import Path

_LRC_TIME = re.compile(r"\[(?:\d{1,2}:)?\d{1,2}:\d{1,2}(?:[.:]\d+)?\]")
_META = re.compile(r"^\[(?:ar|ti|al|by|offset|re|ve):.*?\]\s*$", re.I)


def _clean(text: str) -> str:
    lines = []
    for raw in str(text or "").replace("\ufeff", "").splitlines():
        if _META.match(raw.strip()):
            continue
        line = _LRC_TIME.sub("", raw).strip()
        if line:
            lines.append(line)
    return "\n".join(lines).strip()


def _sidecar(source: Path) -> str:
    for suffix in (".lrc", ".txt"):
        path = source.with_suffix(suffix)
        if path.is_file():
            try:
                value = _clean(path.read_text(encoding="utf-8-sig"))
            except (OSError, UnicodeError):
                continue
            if len(value.split()) >= 3:
                return value
    return ""


def _embedded(source: Path) -> str:
    try:
        import mutagen

        media = mutagen.File(str(source))
    except Exception:
        return ""
    tags = getattr(media, "tags", None)
    if not tags:
        return ""
    candidates = []
    # ID3/MP3 unsynchronised lyrics.
    getall = getattr(tags, "getall", None)
    if callable(getall):
        for frame in getall("USLT") or []:
            candidates.append(getattr(frame, "text", ""))
    # MP4 and Vorbis/FLAC common keys.
    for key in ("\xa9lyr", "LYRICS", "lyrics", "UNSYNCEDLYRICS", "unsyncedlyrics"):
        try:
            value = tags.get(key)
        except Exception:
            value = None
        if isinstance(value, (list, tuple)):
            candidates.extend(value)
        elif value:
            candidates.append(value)
    cleaned = [_clean(str(value)) for value in candidates]
    cleaned = [value for value in cleaned if len(value.split()) >= 3]
    return max(cleaned, key=len, default="")


def discover_lyrics(source: str | Path) -> tuple[str, str | None]:
    """Return trusted local lyrics and their source, without network access."""
    path = Path(source)
    sidecar = _sidecar(path)
    if sidecar:
        return sidecar, "sidecar"
    embedded = _embedded(path)
    if embedded:
        return embedded, "embedded"
    return "", None
