from __future__ import annotations

import html
import json
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass
from difflib import SequenceMatcher


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


def _identity(value: str) -> str:
    value = value.translate(str.maketrans({"i": "і", "I": "і"})).casefold()
    return " ".join(re.findall(r"[\w']+", value, flags=re.UNICODE))


def _parts(value: str) -> tuple[str, str]:
    parts = re.split(r"\s+(?:-|–|—)\s+", value, maxsplit=1)
    return (parts[0].strip(), parts[1].strip()) if len(parts) == 2 else ("", value.strip())


def _matches(expected: str, actual: str, threshold: float = .84) -> bool:
    left, right = _identity(expected), _identity(actual)
    return bool(left and right) and (
        left == right or SequenceMatcher(None, left, right).ratio() >= threshold
    )


def _request(url: str, encoding: str = "utf-8") -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "A&D-Voice/1"})
    with urllib.request.urlopen(request, timeout=8) as response:
        return response.read().decode(encoding, errors="replace")


def _expand_notation(value: str) -> str:
    lines, chorus, output, collecting = value.splitlines(), [], [], False
    for raw in lines:
        line = html.unescape(raw).strip()
        if re.fullmatch(r"(?:приспів|припев)\s*[:.]", line, flags=re.I):
            if line.endswith(":"):
                collecting = True
            elif chorus:
                output.extend(chorus)
            continue
        if not line:
            if collecting and chorus:
                collecting = False
            if output and output[-1]:
                output.append("")
            continue
        repeat = re.search(r"\|\s*\((\d+)\)\s*$", line)
        line = re.sub(r"\s*\|\s*\(\d+\)\s*$", "", line).strip()
        output.extend([line] * (int(repeat.group(1)) if repeat else 1))
        if collecting:
            chorus.append(line)
    return "\n".join(output).strip()


def _pisni(artist: str, track: str, query: str) -> LyricsDiscovery | None:
    try:
        encoded = urllib.parse.quote_from_bytes(track.encode("cp1251"))
        page = _request(
            f"https://www.pisni.org.ua/search.php?phrase={encoded}&obj=s", "cp1251"
        )
        links = dict.fromkeys(re.findall(r'href=["\'](/songs/\d+\.html)["\']', page, re.I))
        for link in list(links)[:8]:
            detail = _request(f"https://www.pisni.org.ua{link}", "cp1251")
            title = re.search(r'<h1[^>]*>(.*?)</h1>', detail, re.I | re.S)
            performer = re.search(r'<a href=["\']/persons/[^"\']+["\'][^>]*>(.*?)</a>', detail, re.I | re.S)
            lyrics = re.search(r'<pre class=["\']songwords["\']>(.*?)</pre>', detail, re.I | re.S)
            if not (title and performer and lyrics):
                continue
            def clean(match):
                return html.unescape(re.sub(r"<[^>]+>", " ", match.group(1))).strip()

            if _matches(track, clean(title)) and (not artist or _matches(artist, clean(performer))):
                text = _expand_notation(clean(lyrics))
                if len(text.split()) >= 15:
                    return LyricsDiscovery(text, "pisni.org.ua", query)
    except (OSError, UnicodeError, ValueError):
        pass
    return None


def discover_lyrics(title: str | None, *_args, **_kwargs) -> LyricsDiscovery | None:
    query = " ".join(str(title or "").replace("_", " ").split())
    if not query:
        return None
    artist, track = _parts(query)
    params = {"track_name": track, "artist_name": artist} if artist else {"q": query}
    url = "https://lrclib.net/api/search?" + urllib.parse.urlencode(params)
    try:
        rows = json.loads(_request(url))
    except (OSError, ValueError):
        rows = []
    for row in rows if isinstance(rows, list) else []:
        if not _matches(track, str(row.get("trackName") or "")):
            continue
        if artist and not _matches(artist, str(row.get("artistName") or "")):
            continue
        synced = row.get("syncedLyrics") or ""
        text = row.get("plainLyrics") or _plain(synced)
        if str(text).strip():
            return LyricsDiscovery(str(text).strip(), "LRCLIB", query, lines=_timed(synced))
    return _pisni(artist, track, query)
