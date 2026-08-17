from __future__ import annotations

import html
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from contextlib import suppress
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
_DOWNLOAD_SOURCE_TAG = re.compile(
    r"\s*[\[(]\s*(?:https?://)?(?:www\.)?(?:[a-z0-9-]+\.)+(?:com|net|org|ru|ua|io|me|cc)"
    r"[^\])]*[\])]\s*$",
    re.I,
)


@dataclass(frozen=True, slots=True)
class LyricsDiscovery:
    text: str = ""
    source: str | None = None
    segments: tuple[tuple[float, float, str], ...] = ()
    query: str | None = None


@dataclass(frozen=True, slots=True)
class LyricsSearchCandidate:
    """Preserve song identity all the way to the provider request.

    ``query`` is the human-readable/web-search string. ``artist`` and ``track``
    are kept separately so exact providers such as LRCLIB do not have to guess
    them back from a flattened string.
    """

    query: str
    artist: str = ""
    track: str = ""


def _attrs(attrs) -> dict[str, str]:
    """Normalize an HTMLParser attribute list into a plain str->str dict."""
    return {str(key): str(value or "") for key, value in attrs}


class _SearchFormHTMLParser(HTMLParser):
    """Discover a simple site-search form without depending on site-specific JS."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.forms: list[dict[str, object]] = []
        self.current: dict[str, object] | None = None

    def handle_starttag(self, tag: str, attrs) -> None:
        values = _attrs(attrs)
        if tag == "form":
            self.current = {
                "action": values.get("action", ""),
                "method": values.get("method", "get").casefold(),
                "inputs": [],
            }
            return
        if self.current is None or tag != "input":
            return
        name = values.get("name", "").strip()
        if not name:
            return
        inputs = self.current["inputs"]
        assert isinstance(inputs, list)
        inputs.append(
            {
                "name": name,
                "type": values.get("type", "text").casefold(),
                "value": values.get("value", ""),
                "placeholder": values.get("placeholder", ""),
            }
        )

    def handle_endtag(self, tag: str) -> None:
        if tag == "form" and self.current is not None:
            self.forms.append(self.current)
            self.current = None


class _AnchorHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.href = ""
        self.buffer: list[str] = []
        self.links: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag != "a":
            return
        values = _attrs(attrs)
        self.href = values.get("href", "")
        self.buffer = []

    def handle_data(self, data: str) -> None:
        if self.href:
            self.buffer.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "a" or not self.href:
            return
        title = " ".join("".join(self.buffer).split())
        if title:
            self.links.append((self.href, title))
        self.href = ""
        self.buffer = []


class _LyricsHTMLParser(HTMLParser):
    """Extract lyrics from known semantic containers without script execution."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.mode: str | None = None
        self.skip_depth = 0
        self.lines: list[str] = []
        self.buffer: list[str] = []

    _attrs = staticmethod(_attrs)

    def handle_starttag(self, tag: str, attrs) -> None:
        values = _attrs(attrs)
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
        if tag == "br":
            self.buffer.append("\n")
            return
        self.depth += 1
        if "b-accord__symbol" in classes:
            self.skip_depth = self.depth
        if "pline" in classes or "single-line" in classes:
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


def _lyrics_log(message: str) -> None:
    """Write concise UTF-8 lyrics status directly to the backend console."""
    stream = getattr(sys, "__stdout__", None) or sys.stdout
    with suppress(Exception):
        encoding = str(getattr(stream, "encoding", "") or "").lower().replace("_", "-")
        if hasattr(stream, "reconfigure") and encoding not in {"utf-8", "utf8"}:
            stream.reconfigure(encoding="utf-8", errors="replace")
        print(message, file=stream, flush=True)


def _lyrics_debug(message: str) -> None:
    """Write provider/candidate diagnostics only when explicitly requested."""
    if os.getenv("KARAOKE_LYRICS_VERBOSE", "").strip().lower() not in {
        "1", "true", "yes", "on"
    }:
        return
    _lyrics_log(message)


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

    # A synced-lyrics provider may return a different/extended cut of the song.
    # Never publish lyric lines whose anchors are already outside this audio file:
    # they cannot be aligned, and keeping them makes lyrics.txt contain words that
    # lyricsSync.json/MIDI can never represent.  This was the direct cause of the
    # A synced provider can contain lyrics from a longer/different cut.  Drop
    # anchors outside the actual audio so canonical text and timing stay complete.
    if duration_sec is not None and duration_sec > 0:
        limit = max(0.0, float(duration_sec) - 0.05)
        timed = [(start, value) for start, value in timed if 0.0 <= start < limit]

    raw_gaps = [
        right[0] - left[0]
        for left, right in zip(timed, timed[1:], strict=False)
        if right[0] > left[0]
    ]
    if raw_gaps:
        ordered = sorted(raw_gaps)
        median_gap = ordered[len(ordered) // 2]
        deviations = sorted(abs(value - median_gap) for value in ordered)
        mad = deviations[len(deviations) // 2] if deviations else 0.0
        robust_limit = median_gap + max(median_gap, mad * 4.0)
        gaps = [value for value in ordered if value <= robust_limit]
        typical_gap = sorted(gaps)[len(gaps) // 2] if gaps else median_gap
    else:
        # No neighboring anchors: derive a song/text-relative phrase scale rather
        # than assuming a universal four-second lyric line.
        if duration_sec is not None and duration_sec > 0 and timed:
            typical_gap = float(duration_sec) / max(1, len(timed))
        else:
            word_counts = [max(1, len(value.split())) for _, value in timed]
            typical_gap = (
                (sum(word_counts) / max(1, len(word_counts))) * 0.55 if word_counts else 1.0
            )

    result: list[tuple[float, float, str]] = []
    for index, (start, value) in enumerate(timed):
        if index + 1 < len(timed):
            next_start = timed[index + 1][0]
        elif duration_sec is not None and duration_sec > start:
            next_start = float(duration_sec)
        else:
            next_start = start + typical_gap
        if duration_sec is not None and duration_sec > 0:
            next_start = min(next_start, float(duration_sec))
        span = max(0.0, next_start - start)
        # Boundary padding and the minimum usable span are both fractions of the
        # actual local/typical line interval. The tiny numerical floor only keeps
        # intervals strictly ordered and is not a song-timing prior.
        boundary_pad = max(1e-4, span * 0.005)
        word_count = max(1, len(value.split()))
        minimum_span = min(
            span, max(1e-3, min(typical_gap * 0.10, span / max(2.0, word_count * 1.5)))
        )
        end = max(start + minimum_span, next_start - boundary_pad)
        if duration_sec is not None and duration_sec > 0:
            end = min(end, float(duration_sec))
        if end > start + 1e-4:
            result.append((start, end, value))
    return tuple(result)


def _local_file(path: Path, duration_sec: float | None = None) -> LyricsDiscovery:
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
            return LyricsDiscovery(value, "sidecar", _parse_lrc(raw, duration_sec))
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
    # starts with a digit (for example an artist-title filename whose title begins with a year/number).
    parts = re.split(
        r"\s*[–—]\s*|\s+-\s*|\s*-\s+|(?<=[A-Za-zА-Яа-яЁё])-\s*(?=[A-Za-zА-Яа-яЁё0-9])",
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


def _online(
    title: str | LyricsSearchCandidate | None, duration_sec: float | None
) -> LyricsDiscovery:
    if os.getenv("KARAOKE_ONLINE_LYRICS", "1").strip().lower() in {"0", "false", "off"}:
        _lyrics_debug("[lyrics] LRCLIB disabled")
        return LyricsDiscovery()

    if isinstance(title, LyricsSearchCandidate):
        display_query = title.query
        artist = title.artist.strip()
        track = (title.track or title.query).strip()
    else:
        display_query = str(title or "").strip()
        artist, track = _track_signature(display_query)

    if not track:
        _lyrics_debug(f"[lyrics] LRCLIB skipped: could not parse query={display_query!r}")
        return LyricsDiscovery()

    query_params = (
        {"track_name": track, "artist_name": artist}
        if artist
        else {"q": display_query or track}
    )
    _lyrics_debug(
        f"[lyrics] LRCLIB request: query={display_query!r} artist={artist!r} track={track!r}"
    )

    query = urllib.parse.urlencode(query_params)
    request = urllib.request.Request(
        f"https://lrclib.net/api/search?{query}",
        headers={"User-Agent": "AAndDVoice/2026.35 (desktop karaoke application)"},
    )
    try:
        with urllib.request.urlopen(request, timeout=8.0) as response:  # noqa: S310
            records = json.loads(response.read().decode("utf-8"))
    except (OSError, UnicodeError, ValueError, urllib.error.URLError) as exc:
        _lyrics_debug(f"[lyrics] LRCLIB request failed: {type(exc).__name__}")
        return LyricsDiscovery()

    if not isinstance(records, list):
        _lyrics_debug("[lyrics] LRCLIB returned non-list response")
        return LyricsDiscovery()

    _lyrics_debug(f"[lyrics] LRCLIB candidates returned: {len(records)}")
    ranked: list[tuple[float, dict]] = []

    for number, item in enumerate(records, 1):
        if not isinstance(item, dict) or item.get("instrumental"):
            continue

        plain = _clean(str(item.get("plainLyrics") or item.get("syncedLyrics") or ""))
        if len(plain.split()) < 15:
            continue

        candidate_track = str(item.get("trackName") or "")
        candidate_artist = str(item.get("artistName") or "")
        track_score = _similarity(track, candidate_track)
        artist_score = _similarity(artist, candidate_artist) if artist else 0.0

        # Exact/structured searches must never surface another performer as a
        # plausible candidate.  Filter it before candidate-level diagnostics.
        if artist and artist_score < 0.82:
            continue

        duration_score = 1.0
        duration_delta = None
        if duration_sec and item.get("duration"):
            duration_delta = abs(float(item["duration"]) - duration_sec)
            duration_score = max(0.0, 1.0 - duration_delta / 12.0)
            if duration_delta > 18.0:
                _lyrics_debug(
                    f"[lyrics] LRCLIB candidate #{number}: "
                    f"artist={candidate_artist!r} title={candidate_track!r} "
                    f"track={track_score:.3f} artistScore={artist_score:.3f} "
                    f"durationDelta={duration_delta:.1f}s -> REJECT duration"
                )
                continue

        accepted = False
        reason = ""
        score = 0.0

        if artist:
            if track_score < 0.88:
                reason = "track mismatch"
            elif artist_score < 0.82:
                reason = "artist mismatch"
            else:
                score = track_score * 0.48 + artist_score * 0.37 + duration_score * 0.15
                accepted = score >= 0.84
                reason = "accepted" if accepted else "score too low"
        else:
            candidate_full = f"{candidate_artist} {candidate_track}".strip()
            full_score = _similarity(display_query or track, candidate_full)
            if full_score < 0.86 and track_score < 0.96:
                reason = "title/full-name mismatch"
            else:
                score = max(
                    full_score * 0.85 + duration_score * 0.15,
                    track_score * 0.80 + duration_score * 0.20,
                )
                accepted = score >= 0.84
                reason = "accepted" if accepted else "score too low"

        _lyrics_debug(
            f"[lyrics] LRCLIB candidate #{number}: "
            f"artist={candidate_artist!r} title={candidate_track!r} "
            f"track={track_score:.3f} artistScore={artist_score:.3f} "
            f"score={score:.3f} -> {'ACCEPT' if accepted else 'REJECT'} ({reason})"
        )

        if accepted:
            ranked.append((score, item))

    if not ranked:
        _lyrics_debug(f"[lyrics] LRCLIB: no acceptable candidate for query={display_query!r}")
        return LyricsDiscovery()

    score, item = max(ranked, key=lambda pair: pair[0])
    candidate_track = str(item.get("trackName") or "")
    candidate_artist = str(item.get("artistName") or "")
    _lyrics_debug(
        f"[lyrics] LRCLIB SELECTED: query={display_query!r} "
        f"artist={candidate_artist!r} title={candidate_track!r} score={score:.3f}"
    )

    synced = str(item.get("syncedLyrics") or "")
    segments = _parse_lrc(synced, duration_sec)
    # Never combine text from plainLyrics with timings from a different/incomplete
    # syncedLyrics payload. LRCLIB records can contain an outro/repetition in
    # plainLyrics that is absent from the timed version for this exact audio.
    # Mixing those two sources makes the pipeline force non-existent words into
    # the final seconds of the song and destroys both lyric and MIDI timing.
    if segments:
        synced_text = "\n".join(segment[2] for segment in segments).strip()
        if len(synced_text.split()) >= 3:
            return LyricsDiscovery(synced_text, "LRCLIB", segments)
    plain = _clean(str(item.get("plainLyrics") or synced))
    return LyricsDiscovery(plain, "LRCLIB")


def _search_tokens_match(query: str, result_title: str) -> bool:
    """Reject unrelated web results aggressively.

    A lyrics page is allowed only when the search-result title contains most of
    the actual query tokens. This intentionally prefers ASR over accepting a
    different song with vaguely similar search-engine text.
    """
    query_tokens = [token for token in _normalize_name(query).split() if len(token) >= 2]
    title_tokens = set(_normalize_name(result_title).split())
    if not query_tokens:
        return False

    matched = sum(token in title_tokens for token in query_tokens)
    coverage = matched / len(query_tokens)
    similarity = _similarity(query, result_title)

    # Multi-token artist+title queries must match almost completely.  For a
    # short/title-only query require an even stronger textual similarity.
    if len(query_tokens) >= 3:
        return coverage >= 0.85 and similarity >= 0.55
    return coverage >= 1.0 and similarity >= 0.72


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


def _decode_html_payload(payload: bytes, header_charset: str | None = None) -> str:
    declared = _HTML_CHARSET.search(payload[:20_000])
    declared_charset = declared.group(1).decode("ascii", "ignore") if declared else None
    # A valid HTTP/meta charset is stronger evidence than a Cyrillic-count
    # heuristic. UTF-8 bytes decoded as cp1251 can accidentally look "more
    # Cyrillic" while actually being mojibake.
    for explicit in (header_charset, declared_charset):
        if not explicit:
            continue
        try:
            return payload.decode(explicit)
        except (LookupError, UnicodeDecodeError):
            pass

    decoded: list[tuple[int, str]] = []
    for candidate in ("utf-8", "windows-1251"):
        try:
            value = payload.decode(candidate)
        except (LookupError, UnicodeDecodeError):
            continue
        cyrillic = len(re.findall(r"[А-Яа-яЁё]", value))
        replacement = value.count("\ufffd")
        decoded.append((cyrillic - replacement * 20, value))
    return max(decoded, key=lambda item: item[0])[1] if decoded else ""


def _read_html(request: urllib.request.Request, limit: int = 1_500_000) -> str:
    try:
        with urllib.request.urlopen(request, timeout=8.0) as response:  # noqa: S310
            payload = response.read(limit)
            headers = getattr(response, "headers", None)
            get_charset = getattr(headers, "get_content_charset", None)
            charset = get_charset() if callable(get_charset) else None
    except (OSError, UnicodeError, urllib.error.URLError):
        return ""
    return _decode_html_payload(payload, charset)


def _mychords_song_matches(result_title: str, artist: str, track: str) -> bool:
    """Match a MyChords song link against the known canonical identity."""
    result_artist, result_track = _track_signature(result_title)
    if not result_track:
        return False
    if artist and _normalize_name(result_artist) != _normalize_name(artist):
        return False
    expected = _normalize_name(track)
    actual = _normalize_name(result_track)
    return bool(expected and actual and (actual == expected or _similarity(actual, expected) >= 0.96))


def _mychords_artist_page(artist: str, headers: dict[str, str]) -> str | None:
    """Resolve an artist page from MyChords' own alphabetical directory."""
    normalized = _normalize_name(artist)
    first = next((char for char in str(artist or '').strip() if char.isalnum()), '')
    if not normalized or not first:
        return None

    letter_url = f"https://mychords.net/ru/letter/{urllib.parse.quote(first.upper(), safe='')}/"
    page = _read_html(urllib.request.Request(letter_url, headers=headers))
    if not page:
        return None

    anchors = _AnchorHTMLParser()
    with suppress(ValueError, UnicodeError):
        anchors.feed(page)
    for raw_url, title in anchors.links:
        if _normalize_name(title) != normalized:
            continue
        url = urllib.parse.urljoin(letter_url, raw_url)
        parsed = urllib.parse.urlparse(url)
        host = (parsed.hostname or '').casefold().removeprefix('www.')
        path = parsed.path.casefold()
        if (
            host == 'mychords.net'
            and path.startswith('/ru/')
            and path.endswith('/')
            and '/letter/' not in path
            and '/search' not in path
            and '/page/' not in path
        ):
            return url
    return None


def _mychords_catalog_search(artist: str, track: str) -> list[tuple[str, str]]:
    """Find a song directly inside a known artist's MyChords catalogue.

    This path does not depend on MyChords' search form or an external search
    engine. The artist is resolved through MyChords' alphabetical directory,
    then the artist catalogue is walked until the exact track is found.
    """
    if not artist or not track:
        return []
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AAndDVoice/2026.35',
        'Accept-Language': 'ru,en;q=0.8',
    }
    artist_url = _mychords_artist_page(artist, headers)
    if not artist_url:
        return []

    def parse_catalog(page_url: str, page: str) -> tuple[list[tuple[str, str]], int]:
        anchors = _AnchorHTMLParser()
        with suppress(ValueError, UnicodeError):
            anchors.feed(page)
        matches: list[tuple[str, str]] = []
        max_page = 1
        artist_path = urllib.parse.urlparse(artist_url).path.rstrip('/') + '/'
        for raw_url, result_title in anchors.links:
            url = urllib.parse.urljoin(page_url, raw_url)
            parsed = urllib.parse.urlparse(url)
            host = (parsed.hostname or '').casefold().removeprefix('www.')
            if host != 'mychords.net':
                continue
            page_match = re.fullmatch(re.escape(artist_path) + r'page/(\d+)/', parsed.path)
            if page_match:
                max_page = max(max_page, int(page_match.group(1)))
                continue
            if not parsed.path.startswith(artist_path) or not parsed.path.endswith('.html'):
                continue
            if _mychords_song_matches(result_title, artist, track):
                matches.append((url, result_title))
        return matches, max_page

    first_page = _read_html(urllib.request.Request(artist_url, headers=headers))
    if not first_page:
        return []
    matches, max_page = parse_catalog(artist_url, first_page)
    if matches:
        return matches[:6]

    # Artist pages are alphabetically paginated.  The catalogue itself tells us
    # how many pages exist; cap it defensively so a malformed page cannot cause
    # an unbounded crawl.
    for page_number in range(2, min(max_page, 20) + 1):
        page_url = urllib.parse.urljoin(artist_url, f'page/{page_number}/')
        page = _read_html(urllib.request.Request(page_url, headers=headers))
        if not page:
            continue
        page_matches, discovered_max = parse_catalog(page_url, page)
        max_page = max(max_page, discovered_max)
        if page_matches:
            return page_matches[:6]
    return []


def _mychords_search(title: str) -> list[tuple[str, str]]:
    """Use MyChords' own generic search form as a fallback discovery path."""
    base = "https://mychords.net/ru/search"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AAndDVoice/2026.35",
        "Accept-Language": "ru,en;q=0.8",
    }
    landing = _read_html(urllib.request.Request(base, headers=headers))
    if not landing:
        return []
    parser = _SearchFormHTMLParser()
    with suppress(ValueError, UnicodeError):
        parser.feed(landing)

    forms = sorted(
        parser.forms,
        key=lambda form: (
            "search" not in str(form.get("action", "")).casefold(),
            not any(
                str(item.get("type", "")).casefold() in {"text", "search"}
                for item in form.get("inputs", [])
                if isinstance(item, dict)
            ),
        ),
    )
    for form in forms:
        inputs = [item for item in form.get("inputs", []) if isinstance(item, dict)]
        text_input = next(
            (
                item
                for item in inputs
                if str(item.get("type", "")).casefold() in {"text", "search"}
            ),
            None,
        )
        if not text_input:
            continue
        payload = {
            str(item["name"]): str(item.get("value", ""))
            for item in inputs
            if item.get("name") and str(item.get("type", "")).casefold() == "hidden"
        }
        payload[str(text_input["name"])] = title
        action = urllib.parse.urljoin(base, str(form.get("action", "") or base))
        method = str(form.get("method", "get")).casefold()
        if method == "post":
            request = urllib.request.Request(
                action, data=urllib.parse.urlencode(payload).encode("utf-8"), headers=headers
            )
        else:
            separator = "&" if urllib.parse.urlparse(action).query else "?"
            request = urllib.request.Request(
                action + separator + urllib.parse.urlencode(payload), headers=headers
            )
        page = _read_html(request)
        if not page:
            continue
        anchors = _AnchorHTMLParser()
        with suppress(ValueError, UnicodeError):
            anchors.feed(page)
        output: list[tuple[str, str]] = []
        seen: set[str] = set()
        for raw_url, result_title in anchors.links:
            url = urllib.parse.urljoin(action, raw_url)
            parsed = urllib.parse.urlparse(url)
            host = (parsed.hostname or "").casefold().removeprefix("www.")
            if host != "mychords.net" or not parsed.path.endswith(".html"):
                continue
            if "/search" in parsed.path or not _search_tokens_match(title, result_title):
                continue
            if url not in seen:
                seen.add(url)
                output.append((url, result_title))
        if output:
            return output[:6]
    return []

def _duckduckgo_search(query: str, title: str) -> list[tuple[str, str]]:
    request = urllib.request.Request(
        "https://html.duckduckgo.com/html/",
        data=urllib.parse.urlencode({"q": query}).encode("utf-8"),
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AAndDVoice/2026.35",
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
    seen: set[str] = set()
    for raw_url, raw_title in matches:
        result_title = re.sub(r"<[^>]+>", " ", html.unescape(raw_title))
        result_title = " ".join(result_title.split())
        url = _safe_result_url(raw_url)
        if url and url not in seen and _search_tokens_match(title, result_title):
            seen.add(url)
            output.append((url, result_title))
    return output[:6]


def _web_search(title: str) -> list[tuple[str, str]]:
    # MyChords often has the exact Russian text while a broad query can rank it
    # below unrelated pages.  Try a site-scoped lookup first, then the generic
    # allow-listed lyrics search.  Both use the same strict title-token gate.
    queries = [
        f'site:mychords.net/ru {title}',
        f'{title} "текст песни" lyrics',
    ]
    output: list[tuple[str, str]] = []
    seen: set[str] = set()
    for query in queries:
        for url, result_title in _duckduckgo_search(query, title):
            if url not in seen:
                seen.add(url)
                output.append((url, result_title))
        if output:
            break
    return output[:6]



def _fetch_web_lyrics(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AAndDVoice/2026.35",
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
    page = _decode_html_payload(payload, header_charset)
    if not page:
        return ""

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
    if host == "mychords.net":
        # MyChords includes a chord/header row inside the same semantic lyrics
        # container, e.g. ``Песня на: E G A D``.  It is page metadata, not a
        # lyric line, and must never reach lyrics.txt/alignment.
        value = "\n".join(
            line
            for line in value.splitlines()
            if not re.match(r"^\s*(?:песня|пісня)\s+на\s*:", line, flags=re.I)
        ).strip()
    words = value.split()
    return value if 30 <= len(words) <= 2500 else ""


def _web_online(title: str | LyricsSearchCandidate | None) -> LyricsDiscovery:
    if not title:
        return LyricsDiscovery()

    if isinstance(title, LyricsSearchCandidate):
        query = title.query
        expected_artist = title.artist.strip()
    else:
        query = str(title).strip()
        expected_artist = ""

    _lyrics_debug(
        f"[lyrics] WEB request: query={query!r} artist={expected_artist!r}"
    )
    track = title.track.strip() if isinstance(title, LyricsSearchCandidate) else query
    results = _mychords_catalog_search(expected_artist, track) if expected_artist else []
    if not results:
        results = _mychords_search(query)
    if not results:
        results = _web_search(query)

    if expected_artist:
        artist_tokens = {
            token for token in _normalize_name(expected_artist).split() if len(token) >= 2
        }
        if artist_tokens:
            results = [
                (url, result_title)
                for url, result_title in results
                if artist_tokens.issubset(set(_normalize_name(result_title).split()))
            ]

    _lyrics_debug(f"[lyrics] WEB matching search results: {len(results)}")

    for number, (url, result_title) in enumerate(results, 1):
        _lyrics_debug(f"[lyrics] WEB candidate #{number}: title={result_title!r} url={url!r}")
        text = _fetch_web_lyrics(url)
        if text:
            host = (urllib.parse.urlparse(url).hostname or "web").removeprefix("www.")
            _lyrics_debug(
                f"[lyrics] WEB SELECTED: query={query!r} result={result_title!r} source={host!r}"
            )
            return LyricsDiscovery(text, f"web:{host}")

        _lyrics_debug(f"[lyrics] WEB candidate #{number}: no usable lyrics -> REJECT")

    _lyrics_debug(f"[lyrics] WEB: no acceptable candidate for query={query!r}")
    return LyricsDiscovery()


def _plain_search_query(value: str | None) -> str:
    """Remove downloader/release noise and collapse an identity into a search query."""
    value = _TITLE_NOISE.sub(" ", str(value or ""))
    # Downloaders commonly append their host to the filename, e.g.
    # ``Нервы-Кофе Мой Друг (zaycev.net)``.  It is not part of the song
    # identity and substantially hurts LRCLIB/web recall.
    value = _DOWNLOAD_SOURCE_TAG.sub(" ", value)
    value = re.sub(r"\s*[\[(][^\]\)]*(?:19|20)\d{2}[^\]\)]*[\])]\s*$", " ", value)
    return " ".join(value.replace("-", " ").replace("–", " ").replace("—", " ").split())


def _strip_filename_copy_suffix(value: str) -> str:
    """Drop downloader duplicate suffixes like ``(2)`` without touching song text."""
    return re.sub(r"\s*[\[(]\s*\d{1,3}\s*[\])]\s*$", "", str(value or "")).strip()


def _filename_search_identity(source: Path) -> tuple[str, str]:
    """Parse Artist-Title filenames when tags are absent.

    ``Artist-Track title(2)`` -> (``Artist``, ``Track title``).  The
    hyphen inside a numeric title remains part of the title because splitting happens
    only once at the artist/title boundary.
    """
    stem = _strip_filename_copy_suffix(source.stem)
    artist, track = _track_signature(stem)
    return artist.strip(), _strip_filename_copy_suffix(track).strip()


def _metadata_search_plan(
    source: str | Path,
    fallback: str | None,
) -> list[LyricsSearchCandidate]:
    """Build structured identities without flattening artist/title information."""
    source = Path(source)
    tagged_title = ""
    tagged_artist = ""
    tagged_album = ""

    try:
        from mutagen import File as MutagenFile

        audio = MutagenFile(source, easy=True)
        if audio is not None:

            def first(*keys: str) -> str:
                for key in keys:
                    value = audio.get(key)
                    if isinstance(value, (list, tuple)) and value:
                        value = value[0]
                    if value:
                        return str(value).strip()
                return ""

            tagged_title = first("title")
            tagged_artist = first("artist", "albumartist")
            tagged_album = first("album")
    except Exception:
        pass

    candidates: list[LyricsSearchCandidate] = []
    technical_names = {
        "source",
        "song",
        "audio",
        "input",
        "upload",
        "uploaded",
        "temp",
        "temporary",
        "decoded",
        "converted",
    }

    def add_query(value: str) -> None:
        query = _plain_search_query(value)
        if query and query.casefold() not in technical_names:
            candidates.append(LyricsSearchCandidate(query=query, track=query))

    def add_identity(artist: str, title: str) -> None:
        clean_artist = _plain_search_query(str(artist or "").strip())
        clean_title = _plain_search_query(
            _strip_filename_copy_suffix(str(title or "").strip())
        )
        if not clean_title:
            return
        if clean_artist:
            # Once an artist is known, NEVER drop it on a broader/title-only
            # fallback.  ``query`` may become shorter for web discovery, but
            # providers and candidate validation must keep the canonical artist.
            candidates.append(
                LyricsSearchCandidate(
                    query=f"{clean_artist} {clean_title}",
                    artist=clean_artist,
                    track=clean_title,
                )
            )
            if clean_title.casefold() not in technical_names:
                candidates.append(
                    LyricsSearchCandidate(
                        query=clean_title,
                        artist=clean_artist,
                        track=clean_title,
                    )
                )
            return
        add_query(clean_title)

    def strip_leading_artist(title: str, artist: str) -> str:
        clean_title = _plain_search_query(title)
        clean_artist = _plain_search_query(artist)
        if not clean_title or not clean_artist:
            return clean_title
        prefix = clean_artist + " "
        if clean_title.casefold().startswith(prefix.casefold()):
            return clean_title[len(prefix) :].strip() or clean_title
        return clean_title

    filename_artist, filename_title = _filename_search_identity(source)
    clean_stem = _strip_filename_copy_suffix(source.stem)
    normalized_stem = _normalize_name(clean_stem)
    filename_is_real = normalized_stem not in technical_names and bool(filename_title)

    # 1) Embedded metadata has highest priority, but real-world tags are often
    # polluted by downloader/album text.  Use the explicit album tag to remove
    # that pollution and avoid duplicated identities such as
    # ``Нервы Всё, Что Вокруг Нервы Моя Леди``.
    if tagged_title:
        clean_artist = tagged_artist
        if clean_artist:
            if tagged_album:
                clean_artist = re.sub(re.escape(tagged_album), " ", clean_artist, flags=re.I)
            clean_artist = re.sub(re.escape(tagged_title), " ", clean_artist, flags=re.I)
            clean_artist = re.sub(r"\b(?:single|album|ep)\b", " ", clean_artist, flags=re.I)
            clean_artist = re.sub(r"[\[(]\s*(?:19|20)\d{2}\s*[\])]", " ", clean_artist)
            clean_artist = _plain_search_query(clean_artist)

        clean_title = _plain_search_query(tagged_title)
        # If the album tag is absent but artist/title share a leading identity
        # (e.g. artist="Нервы Всё, Что Вокруг", title="Нервы Моя Леди"),
        # the shared prefix is a safer artist candidate than the polluted tag.
        artist_words = clean_artist.split() if clean_artist else []
        title_words = clean_title.split()
        shared: list[str] = []
        for left, right in zip(artist_words, title_words, strict=False):
            if left.casefold() != right.casefold():
                break
            shared.append(left)
        if shared and len(shared) < len(artist_words):
            clean_artist = " ".join(shared)

        # Prefer the clean metadata artist, then the filename artist as a
        # trustworthy fallback for malformed tags.  This removes duplicated
        # artist prefixes from titles without guessing arbitrary words.
        for known_artist in (clean_artist, filename_artist or ""):
            stripped = strip_leading_artist(clean_title, known_artist)
            if stripped != clean_title:
                clean_title = stripped
                break
        add_identity(clean_artist or (filename_artist or ""), clean_title)

    # 2) Backend-provided identity. It may be structured as "Artist - Title".
    fallback_value = str(fallback or "").strip()
    if fallback_value:
        fallback_artist, fallback_title = _track_signature(fallback_value)
        if fallback_artist and fallback_title:
            add_identity(fallback_artist, fallback_title)
        elif not tagged_title:
            add_query(fallback_value)

    # 3) The real filename is an independent fallback even when tags exist.
    # Broken download metadata is common; keeping a clean filename identity
    # prevents a single bad album/artist tag from forcing an expensive ASR run.
    if filename_is_real:
        add_identity(filename_artist or "", filename_title)

    # Stable de-duplication by visible query. The first occurrence wins, so an
    # exact structured artist+track candidate is never replaced by a later
    # title-only/string fallback with the same display text.
    unique: list[LyricsSearchCandidate] = []
    indexes: dict[str, int] = {}
    for candidate in candidates:
        key = candidate.query.casefold()
        index = indexes.get(key)
        if index is None:
            indexes[key] = len(unique)
            unique.append(candidate)
            continue
        # Prefer the identity that retains an artist.  A title-only fallback
        # built earlier must never erase artist information recovered later
        # from filename/metadata.
        if not unique[index].artist and candidate.artist:
            unique[index] = candidate
    return unique


def _metadata_search_candidates(
    source: str | Path, fallback: str | None
) -> list[str]:
    """Compatibility view used by diagnostics/tests: only visible query strings."""
    return [candidate.query for candidate in _metadata_search_plan(source, fallback)]


def discover_lyrics(
    source: str | Path,
    *,
    title: str | None = None,
    duration_sec: float | None = None,
) -> LyricsDiscovery:
    """Search sidecar, embedded metadata and exact online identities, then use ASR."""
    source = Path(source)
    local = _local_file(source, duration_sec)
    if local.text:
        return local
    embedded = _embedded(source)
    if embedded:
        return LyricsDiscovery(embedded, "metadata")
    plan = _metadata_search_plan(source, title)
    queries = [candidate.query for candidate in plan]
    _lyrics_log(f"[lyrics] exact search plan ({len(queries)} queries): {queries!r}")

    for index, candidate in enumerate(plan, 1):
        query = candidate.query
        _lyrics_debug(f"[lyrics] SEARCH #{index} BEGIN: {query}")

        online = _online(candidate, duration_sec)
        if online.text:
            _lyrics_log(f"[lyrics] FOUND via {online.source}: {query}")
            return LyricsDiscovery(online.text, online.source, online.segments, query)

        _lyrics_debug(f"[lyrics] SEARCH #{index} LRCLIB NOT FOUND: {query}")

        web = _web_online(candidate)
        if web.text:
            _lyrics_log(f"[lyrics] FOUND via {web.source}: {query}")
            return LyricsDiscovery(web.text, web.source, web.segments, query)

        _lyrics_debug(f"[lyrics] SEARCH #{index} END NOT FOUND: {query}")

    _lyrics_log("[lyrics] NOT FOUND online -> ASR fallback")
    return LyricsDiscovery()
