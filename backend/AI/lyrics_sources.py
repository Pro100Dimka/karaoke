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


@dataclass(frozen=True, slots=True)
class LyricsDiscovery:
    text: str = ""
    source: str | None = None
    segments: tuple[tuple[float, float, str], ...] = ()
    query: str | None = None


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


def _lyrics_debug(message: str) -> None:
    """Write lyrics diagnostics directly to the real backend console."""
    stream = getattr(sys, "__stdout__", None) or sys.stdout
    with suppress(Exception):
        print(message, file=stream, flush=True)


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


def _online(title: str | None, duration_sec: float | None) -> LyricsDiscovery:
    if os.getenv("KARAOKE_ONLINE_LYRICS", "1").strip().lower() in {"0", "false", "off"}:
        _lyrics_debug("[lyrics] LRCLIB disabled")
        return LyricsDiscovery()

    artist, track = _track_signature(title)
    if not track:
        _lyrics_debug(f"[lyrics] LRCLIB skipped: could not parse query={title!r}")
        return LyricsDiscovery()

    query_params = (
        {"track_name": track, "artist_name": artist} if artist else {"q": str(title or track)}
    )
    _lyrics_debug(f"[lyrics] LRCLIB request: query={title!r} artist={artist!r} track={track!r}")

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
            full_score = _similarity(str(title or track), candidate_full)
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
        _lyrics_debug(f"[lyrics] LRCLIB: no acceptable candidate for query={title!r}")
        return LyricsDiscovery()

    score, item = max(ranked, key=lambda pair: pair[0])
    candidate_track = str(item.get("trackName") or "")
    candidate_artist = str(item.get("artistName") or "")
    _lyrics_debug(
        f"[lyrics] LRCLIB SELECTED: query={title!r} "
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


def _web_search(title: str) -> list[tuple[str, str]]:
    query = f'{title} "текст песни" lyrics'
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

    _lyrics_debug(f"[lyrics] WEB request: query={title!r}")
    results = _web_search(title)
    _lyrics_debug(f"[lyrics] WEB matching search results: {len(results)}")

    for number, (url, result_title) in enumerate(results, 1):
        _lyrics_debug(f"[lyrics] WEB candidate #{number}: title={result_title!r} url={url!r}")
        text = _fetch_web_lyrics(url)
        if text:
            host = (urllib.parse.urlparse(url).hostname or "web").removeprefix("www.")
            _lyrics_debug(
                f"[lyrics] WEB SELECTED: query={title!r} result={result_title!r} source={host!r}"
            )
            return LyricsDiscovery(text, f"web:{host}")

        _lyrics_debug(f"[lyrics] WEB candidate #{number}: no usable lyrics -> REJECT")

    _lyrics_debug(f"[lyrics] WEB: no acceptable candidate for query={title!r}")
    return LyricsDiscovery()


def _plain_search_query(value: str | None) -> str:
    """Remove separator dashes/noisy trailing release tags and collapse spaces."""
    value = str(value or "")
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


def _metadata_search_candidates(
    source: str | Path,
    fallback: str | None,
) -> list[str]:
    """Build queries from real song identity and reject temp pipeline names."""
    source = Path(source)
    tagged_title = ""
    tagged_artist = ""

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
    except Exception:
        pass

    candidates: list[str] = []
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
            candidates.append(query)

    def add_identity(artist: str, title: str) -> None:
        artist = str(artist or "").strip()
        title = _strip_filename_copy_suffix(str(title or "").strip())
        add_query(f"{artist} {title}" if artist else title)
        add_query(title)

    # 1) Embedded metadata has highest priority.
    if tagged_title:
        clean_artist = tagged_artist
        if clean_artist:
            clean_artist = re.sub(re.escape(tagged_title), " ", clean_artist, flags=re.I)
            clean_artist = re.sub(r"\b(?:single|album|ep)\b", " ", clean_artist, flags=re.I)
            clean_artist = re.sub(r"[\[(]\s*(?:19|20)\d{2}\s*[\])]", " ", clean_artist)
            clean_artist = _plain_search_query(clean_artist)
        add_identity(clean_artist, tagged_title)

    # 2) Backend-provided identity. It may be structured as "Artist - Title".
    fallback_value = str(fallback or "").strip()
    if not tagged_title and fallback_value:
        fallback_artist, fallback_title = _track_signature(fallback_value)
        if fallback_artist and fallback_title:
            add_identity(fallback_artist, fallback_title)
        else:
            add_query(fallback_value)

    # 3) Real filename can refine the identity (especially title-only), but a
    # temp filename such as source.wav must NEVER become a lyrics query.
    clean_stem = _strip_filename_copy_suffix(source.stem)
    normalized_stem = _normalize_name(clean_stem)
    if not tagged_title and normalized_stem not in technical_names:
        file_artist, file_title = _filename_search_identity(source)
        if file_title:
            add_identity(file_artist, file_title)

    # Stable de-duplication.
    unique: list[str] = []
    seen: set[str] = set()
    for query in candidates:
        key = query.casefold()
        if key not in seen:
            seen.add(key)
            unique.append(query)
    return unique


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
    queries = _metadata_search_candidates(source, title)
    _lyrics_debug(f"[lyrics] exact search plan ({len(queries)} queries): {queries!r}")

    for index, query in enumerate(queries, 1):
        _lyrics_debug(f"[lyrics] SEARCH #{index} BEGIN: {query}")

        online = _online(query, duration_sec)
        if online.text:
            _lyrics_debug(f"[lyrics] SEARCH #{index} FOUND via {online.source}: {query}")
            return LyricsDiscovery(online.text, online.source, online.segments, query)

        _lyrics_debug(f"[lyrics] SEARCH #{index} LRCLIB NOT FOUND: {query}")

        web = _web_online(query)
        if web.text:
            _lyrics_debug(f"[lyrics] SEARCH #{index} FOUND via {web.source}: {query}")
            return LyricsDiscovery(web.text, web.source, web.segments, query)

        _lyrics_debug(f"[lyrics] SEARCH #{index} END NOT FOUND: {query}")

    _lyrics_debug("[lyrics] ALL SEARCH QUERIES FAILED -> ASR")
    return LyricsDiscovery()
