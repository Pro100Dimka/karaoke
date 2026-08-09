from __future__ import annotations

import html
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from difflib import SequenceMatcher
from html.parser import HTMLParser
from pathlib import Path

_LRC_TIME = re.compile(r"\[(?P<minutes>\d{1,3}):(?P<seconds>\d{1,2}(?:[.:]\d+)?)\]")
_META = re.compile(r"^\[(?:ar|ti|al|by|offset|re|ve):.*?\]\s*$", re.I)
_SECTION_LABEL = re.compile(
    r"^(?:(?:припев|куплет|бридж|проигрыш|вступление|финал|chorus|verse|bridge|intro|outro)"
    r"(?:\s*\d+)?)\s*[:.]?\s*$",
    re.I,
)
_TITLE_NOISE = re.compile(
    r"\s*[\[(](?:official|lyrics?|audio|video|music video|320\s*kbps|hq|hd).*?[\])]\s*",
    re.I,
)
_WEB_LYRICS_HOSTS = {
    "muztext.com",
    "mychords.net",
    "genius.com",
    "lyricsworld.ru",
    "tekstan.ru",
    "tekstovnet.ru",
    "l-hit.com",
    "tekstipesen.com",
    "altwall.net",
    "tekst-pesni.online",
    "911pesni.ru",
    "zaycev.net",
}

_HTML_CHARSET = re.compile(rb"charset\s*=\s*['\"]?([a-zA-Z0-9._-]+)", re.I)


@dataclass(frozen=True, slots=True)
class LyricsDiscovery:
    text: str = ""
    source: str | None = None
    segments: tuple[tuple[float, float, str], ...] = ()


class _LyricsHTMLParser(HTMLParser):
    """Extract lyrics from known semantic containers without script execution."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.mode: str | None = None
        self.skip_depth = 0
        self.lines: list[str] = []
        self.buffer: list[str] = []

    @staticmethod
    def _attrs(attrs) -> dict[str, str]:
        return {str(key): str(value or "") for key, value in attrs}

    def handle_starttag(self, tag: str, attrs) -> None:
        values = self._attrs(attrs)
        classes = set(values.get("class", "").split())
        if self.mode is None and tag == "td" and "lyrics-cell" in classes:
            self.mode = "cell"
            self.depth = 1
            self.buffer = []
            return
        if self.mode is None and values.get("itemprop") == "lyrics":
            self.mode = "semantic"
            self.depth = 1
            self.buffer = []
            return
        if self.mode is None:
            return
        self.depth += 1
        if "b-accord__symbol" in classes:
            self.skip_depth = self.depth
        if tag == "br" or "pline" in classes or "single-line" in classes:
            self.buffer.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if self.mode is None:
            return
        if self.skip_depth == self.depth:
            self.skip_depth = 0
        self.depth -= 1
        if self.depth > 0:
            return
        value = "\n".join(
            " ".join(line.split()) for line in "".join(self.buffer).splitlines() if line.strip()
        )
        if value:
            self.lines.append(value)
        self.mode = None
        self.buffer = []

    def handle_data(self, data: str) -> None:
        if self.mode is not None and not self.skip_depth:
            self.buffer.append(data)

    def text(self) -> str:
        return "\n".join(self.lines)


def _clean(text: str) -> str:
    lines = []
    for raw in str(text or "").replace("\ufeff", "").splitlines():
        if _META.match(raw.strip()):
            continue
        line = _LRC_TIME.sub("", raw).strip()
        if line and not _SECTION_LABEL.match(line):
            lines.append(line)
    return "\n".join(lines).strip()


def _parse_lrc(
    text: str, duration_sec: float | None = None
) -> tuple[tuple[float, float, str], ...]:
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
    # Accept the filename forms produced by common downloaders: ``Artist - Title``,
    # ``Artist -Title`` and ``Artist–Title``.  A bare ASCII hyphen without any
    # surrounding whitespace is deliberately not split when the right hand side
    # starts with a digit (for example ``TRITIA-31-я весна``).
    parts = re.split(
        r"\s*[–—]\s*|\s+-\s*|\s*-\s+|(?<=[A-Za-zА-Яа-яЁё])-\s*(?=[A-Za-zА-Яа-яЁё])",
        value,
        maxsplit=1,
    )
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
        {"track_name": track, "artist_name": artist} if artist else {"q": str(title or track)}
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


def _search_tokens_match(query: str, result_title: str) -> bool:
    query_tokens = set(_normalize_name(query).split())
    title_tokens = set(_normalize_name(result_title).split())
    meaningful = {token for token in query_tokens if len(token) >= 2}
    if not meaningful:
        return False
    coverage = len(meaningful & title_tokens) / len(meaningful)
    return coverage >= 0.66 or _similarity(query, result_title) >= 0.68


def _safe_result_url(raw: str) -> str | None:
    value = html.unescape(raw)
    parsed = urllib.parse.urlparse(value)
    if parsed.hostname and parsed.hostname.endswith("duckduckgo.com"):
        target = urllib.parse.parse_qs(parsed.query).get("uddg", [""])[0]
        parsed = urllib.parse.urlparse(target)
        value = target
    host = (parsed.hostname or "").casefold().removeprefix("www.")
    if parsed.scheme != "https" or host not in _WEB_LYRICS_HOSTS:
        return None
    return value


def _web_search(title: str) -> list[tuple[str, str]]:
    query = f'{title} "текст песни" lyrics'
    request = urllib.request.Request(
        "https://html.duckduckgo.com/html/",
        data=urllib.parse.urlencode({"q": query}).encode("utf-8"),
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) KaraokeStudio/2026.35",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=8.0) as response:  # noqa: S310
            page = response.read(1_500_000).decode("utf-8", "ignore")
    except (OSError, UnicodeError, urllib.error.URLError):
        return []
    matches = re.findall(
        r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
        page,
        flags=re.I | re.S,
    )
    output: list[tuple[str, str]] = []
    for raw_url, raw_title in matches:
        result_title = re.sub(r"<[^>]+>", " ", html.unescape(raw_title))
        result_title = " ".join(result_title.split())
        url = _safe_result_url(raw_url)
        if url and _search_tokens_match(title, result_title):
            output.append((url, result_title))
    return output[:6]


def _fetch_web_lyrics(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) KaraokeStudio/2026.35",
            "Accept-Language": "ru,en;q=0.8",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=7.0) as response:  # noqa: S310
            payload = response.read(3_000_000)
            headers = getattr(response, "headers", None)
            get_charset = getattr(headers, "get_content_charset", None)
            header_charset = get_charset() if callable(get_charset) else None
    except (OSError, UnicodeError, urllib.error.URLError):
        return ""
    declared = _HTML_CHARSET.search(payload[:20_000])
    encoding = header_charset or (declared.group(1).decode("ascii", "ignore") if declared else None)
    candidates = []
    for candidate in (encoding, "utf-8", "windows-1251"):
        if not candidate or candidate in candidates:
            continue
        candidates.append(candidate)
    decoded = []
    for candidate in candidates:
        try:
            value = payload.decode(candidate)
        except (LookupError, UnicodeDecodeError):
            continue
        # Correctly decoded Russian pages contain substantially more Cyrillic
        # than mojibake punctuation/control characters.
        cyrillic = len(re.findall(r"[А-Яа-яЁё]", value))
        replacement = value.count("\ufffd")
        decoded.append((cyrillic - replacement * 20, value))
    if not decoded:
        return ""
    page = max(decoded, key=lambda item: item[0])[1]

    host = (urllib.parse.urlparse(url).hostname or "").casefold().removeprefix("www.")
    if host == "tekstipesen.com":
        # This site exposes no semantic lyrics attribute.  Its song body is the
        # first plain div after the advertising placeholder and ends before the
        # second advertisement block.
        match = re.search(
            r'<div\s+class="cls".*?</div>\s*<br\s*/?>\s*<div>(.*?)</div>',
            page,
            flags=re.I | re.S,
        )
        if match:
            fragment = re.sub(r"<br\s*/?>", "\n", match.group(1), flags=re.I)
            fragment = re.sub(r"<[^>]+>", " ", fragment)
            value = _clean(html.unescape(fragment))
            if 30 <= len(value.split()) <= 2500:
                return value
    parser = _LyricsHTMLParser()
    try:
        parser.feed(page)
    except (ValueError, UnicodeError):
        return ""
    value = _clean(parser.text())
    words = value.split()
    return value if 30 <= len(words) <= 2500 else ""


def _web_online(title: str | None) -> LyricsDiscovery:
    if not title:
        return LyricsDiscovery()
    for url, _result_title in _web_search(title):
        text = _fetch_web_lyrics(url)
        if text:
            host = (urllib.parse.urlparse(url).hostname or "web").removeprefix("www.")
            return LyricsDiscovery(text, f"web:{host}")
    return LyricsDiscovery()


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
    online = _online(title, duration_sec)
    return online if online.text else _web_online(title)
