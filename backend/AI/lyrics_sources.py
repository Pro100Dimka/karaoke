from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path

_LRC_TIME = re.compile(r"\[(?P<minutes>\d{1,3}):(?P<seconds>\d{1,2}(?:[.:]\d+)?)\]")
_META = re.compile(r"^\[(?:ar|ti|al|by|offset|re|ve):.*?\]\s*$", re.I)
_TITLE_NOISE = re.compile(
    r"\s*[\[(](?:official|lyrics?|audio|video|music video|320\s*kbps|hq|hd).*?[\])]\s*",
    re.I,
)


@dataclass(frozen=True, slots=True)
class LyricsDiscovery:
    text: str = ""
    source: str | None = None
    segments: tuple[tuple[float, float, str], ...] = ()


def _clean(text: str) -> str:
    lines = []
    for raw in str(text or "").replace("\ufeff", "").splitlines():
        if _META.match(raw.strip()):
            continue
        line = _LRC_TIME.sub("", raw).strip()
        if line:
            lines.append(line)
    return "\n".join(lines).strip()


def _parse_lrc(text: str, duration_sec: float | None = None) -> tuple[tuple[float, float, str], ...]:
    timed: list[tuple[float, str]] = []
    for raw in str(text or "").replace("\ufeff", "").splitlines():
        match = _LRC_TIME.search(raw)
        if not match:
            continue
        value = _LRC_TIME.sub("", raw).strip()
        if not value:
            continue
        start = int(match.group("minutes")) * 60 + float(match.group("seconds").replace(":", "."))
        timed.append((start, value))
    timed.sort(key=lambda item: item[0])
    result: list[tuple[float, float, str]] = []
    for index, (start, value) in enumerate(timed):
        next_start = timed[index + 1][0] if index + 1 < len(timed) else start + 8.0
        if duration_sec and index + 1 == len(timed):
            next_start = min(next_start, duration_sec)
        end = max(start + 0.25, next_start - 0.02)
        result.append((start, end, value))
    return tuple(result)


def _local_file(path: Path) -> LyricsDiscovery:
    for suffix in (".lrc", ".txt"):
        candidate = path.with_suffix(suffix)
        if not candidate.is_file():
            continue
        try:
            raw = candidate.read_text(encoding="utf-8-sig")
        except (OSError, UnicodeError):
            continue
        value = _clean(raw)
        if len(value.split()) >= 3:
            return LyricsDiscovery(value, "sidecar", _parse_lrc(raw))
    return LyricsDiscovery()


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
    getall = getattr(tags, "getall", None)
    if callable(getall):
        for frame in getall("USLT") or []:
            candidates.append(getattr(frame, "text", ""))
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


def _normalize_name(value: str) -> str:
    value = _TITLE_NOISE.sub(" ", str(value or ""))
    value = re.sub(r"[^\wа-яё]+", " ", value.casefold(), flags=re.I)
    return " ".join(value.split())


def _track_signature(title: str | None) -> tuple[str, str]:
    value = _TITLE_NOISE.sub(" ", str(title or "")).strip(" -_")
    parts = re.split(r"\s+[–—-]\s+", value, maxsplit=1)
    if len(parts) != 2:
        return "", value
    artist = parts[0].strip()
    track = re.sub(r"\s*[\[(].*?[\])]\s*$", "", parts[1]).strip()
    return artist, track


def _similarity(left: str, right: str) -> float:
    return SequenceMatcher(None, _normalize_name(left), _normalize_name(right)).ratio()


def _online(title: str | None, duration_sec: float | None) -> LyricsDiscovery:
    if os.getenv("KARAOKE_ONLINE_LYRICS", "1").strip().lower() in {"0", "false", "off"}:
        return LyricsDiscovery()
    artist, track = _track_signature(title)
    if not track:
        return LyricsDiscovery()
    # Prefer structured metadata, but do not require one exact filename style.
    # Downloads frequently use ``Artist-Title`` without spaces and files with
    # title-only metadata are valid too. LRCLIB's free query handles both while
    # the ranking below still rejects unrelated results.
    query_params = (
        {"track_name": track, "artist_name": artist}
        if artist
        else {"q": str(title or track)}
    )
    query = urllib.parse.urlencode(query_params)
    request = urllib.request.Request(
        f"https://lrclib.net/api/search?{query}",
        headers={"User-Agent": "KaraokeStudio/2026.35 (desktop karaoke application)"},
    )
    try:
        with urllib.request.urlopen(request, timeout=8.0) as response:  # noqa: S310
            records = json.loads(response.read().decode("utf-8"))
    except (OSError, UnicodeError, ValueError, urllib.error.URLError):
        return LyricsDiscovery()
    if not isinstance(records, list):
        return LyricsDiscovery()

    ranked: list[tuple[float, dict]] = []
    for item in records:
        if not isinstance(item, dict) or item.get("instrumental"):
            continue
        plain = _clean(str(item.get("plainLyrics") or item.get("syncedLyrics") or ""))
        if len(plain.split()) < 15:
            continue
        track_score = _similarity(track, str(item.get("trackName") or ""))
        candidate_artist = str(item.get("artistName") or "")
        artist_score = _similarity(artist, candidate_artist) if artist else 0.0
        duration_score = 1.0
        if duration_sec and item.get("duration"):
            delta = abs(float(item["duration"]) - duration_sec)
            duration_score = max(0.0, 1.0 - delta / 12.0)
            if delta > 18.0:
                continue
        if artist:
            if track_score < 0.72 or artist_score < 0.65:
                continue
            score = track_score * 0.48 + artist_score * 0.37 + duration_score * 0.15
        else:
            candidate_full = f"{candidate_artist} - {item.get('trackName') or ''}"
            full_score = _similarity(str(title or track), candidate_full)
            # With missing artist metadata, require either a strong full-name
            # match or an almost exact track name plus matching duration.
            if full_score < 0.72 and track_score < 0.90:
                continue
            score = max(
                full_score * 0.85 + duration_score * 0.15,
                track_score * 0.80 + duration_score * 0.20,
            )
        ranked.append((score, item))
    if not ranked:
        return LyricsDiscovery()
    score, item = max(ranked, key=lambda pair: pair[0])
    if score < 0.76:
        return LyricsDiscovery()
    synced = str(item.get("syncedLyrics") or "")
    plain = _clean(str(item.get("plainLyrics") or synced))
    return LyricsDiscovery(plain, "LRCLIB", _parse_lrc(synced, duration_sec))


def discover_lyrics(
    source: str | Path,
    *,
    title: str | None = None,
    duration_sec: float | None = None,
) -> LyricsDiscovery:
    """Find verified lyrics without ever silently trusting chat/example text."""
    path = Path(source)
    local = _local_file(path)
    if local.text:
        return local
    embedded = _embedded(path)
    if embedded:
        return LyricsDiscovery(embedded, "embedded")
    return _online(title, duration_sec)
