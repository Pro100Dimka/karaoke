from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class TimedLine:
    start: float
    text: str


@dataclass(frozen=True, slots=True)
class LyricsDiscovery:
    text: str
    source: str
    query: str
    language: str | None = None
    lines: tuple[TimedLine, ...] = ()


def _plain(value: str) -> str:
    return re.sub(r"^\s*\[\d{1,2}:\d{2}(?:\.\d+)?]\s*", "", value, flags=re.MULTILINE).strip()


def _timed(value: str) -> tuple[TimedLine, ...]:
    lines = []
    for row in value.splitlines():
        if match := re.match(r"^\s*\[(\d{1,2}):(\d{2}(?:\.\d+)?)\]\s*(.+?)\s*$", row):
            text = match[3].strip()
            if text:
                lines.append(TimedLine(int(match[1]) * 60 + float(match[2]), text))
    return tuple(lines)


def discover_lyrics(title: str | None, *_args, **_kwargs) -> LyricsDiscovery | None:
    query = " ".join(str(title or "").replace("_", " ").split())
    if not query:
        return None
    url = "https://lrclib.net/api/search?" + urllib.parse.urlencode({"q": query})
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "A&D-Voice/1"})
        with urllib.request.urlopen(request, timeout=8) as response:
            rows = json.load(response)
    except (OSError, ValueError):
        return None
    for row in rows if isinstance(rows, list) else []:
        synced = row.get("syncedLyrics") or ""
        text = row.get("plainLyrics") or _plain(synced)
        if str(text).strip():
            return LyricsDiscovery(str(text).strip(), "LRCLIB", query, lines=_timed(synced))
    return None
