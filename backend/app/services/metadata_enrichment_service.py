"""Fast, optional song metadata enrichment outside the AI processing path."""

from __future__ import annotations

import html
import io
import json
import logging
import os
import re
import threading
import urllib.parse
import urllib.request

from PIL import Image, UnidentifiedImageError
from sqlalchemy import select

import models
from app import repositories
from app.services import revision_cache
from app.services.db_utils import commit
from database import SessionLocal

logger = logging.getLogger(__name__)

_YOUTUBE_ID_RE = re.compile(r'"videoId":"([\w-]{11})"')
_PLAIN_YOUTUBE_ID_RE = re.compile(r"[\w-]{11}")
_YOUTUBE_URL_ID_RE = re.compile(
    r"(?:youtu\.be/|youtube(?:-nocookie)?\.com/(?:watch\?(?:[^#]*&)?v=|embed/|shorts/|live/))([\w-]{11})",
    re.IGNORECASE,
)
_LOW_QUALITY_VIDEO_HINTS = (
    "audio only", "official audio", "lyric", "lyrics", "karaoke", "visualizer",
    "static image", "still image", "slowed", "nightcore", "8d audio", "cover version",
    "reaction", "tutorial", "instrumental", "full album", "topic - auto-generated",
    "текст песни", "слова песни", "караоке", "аудио", "обложка",
)
_GOOD_VIDEO_HINTS = ("official music video", "official video", "music video", "премьера клипа", "клип")
_active: set[str] = set()
_validated_video_urls: set[str] = set()
_lock = threading.Lock()


def _request(url: str, timeout: float = 3.0) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json,text/html;q=0.9",
            "User-Agent": "A&D Voice/0.3 metadata lookup",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read(2_000_000)


def _itunes_genre(title: str, artist: str | None) -> str | None:
    query = " ".join(value for value in (artist, title) if value).strip()
    if not query: return None
    url = "https://itunes.apple.com/search?" + urllib.parse.urlencode({
        "term": query,
        "media": "music",
        "entity": "song",
        "limit": 3,
    })
    payload = json.loads(_request(url).decode("utf-8"))
    results = payload.get("results", []) if isinstance(payload, dict) else []
    for result in results if isinstance(results, list) else []:
        genre = result.get("primaryGenreName") if isinstance(result, dict) else None
        if isinstance(genre, str) and genre.strip(): return genre.strip()
    return None


def _words(value: str | None) -> set[str]:
    return set(re.findall(r"[\w\d]+", (value or "").casefold(), flags=re.UNICODE))


def _youtube_id_from_url(url: str | None) -> str | None:
    match = _YOUTUBE_URL_ID_RE.search(url or "")
    return match.group(1) if match else None


def _candidate_score(
    candidate_title: str,
    author: str | None,
    title: str,
    artist: str | None,
) -> int | None:
    normalized = " ".join(candidate_title.casefold().split())
    if any(hint in normalized for hint in _LOW_QUALITY_VIDEO_HINTS): return None
    title_words = _words(title)
    candidate_words = _words(candidate_title)
    if title_words and len(title_words & candidate_words) < max(1, (len(title_words) + 1) // 2):
        return None
    artist_words = _words(artist)
    author_words = _words(author)
    searchable_artist = candidate_words | author_words
    if artist_words and not artist_words & searchable_artist: return None
    score = 10 * len(title_words & candidate_words) + 6 * len(artist_words & searchable_artist)
    score += next((30 for hint in _GOOD_VIDEO_HINTS if hint in normalized), 0)
    return score


def _youtube_oembed(video_id: str) -> dict | None:
    url = "https://www.youtube.com/oembed?" + urllib.parse.urlencode({
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "format": "json",
    })
    payload = json.loads(_request(url, timeout=2.5).decode("utf-8"))
    return payload if isinstance(payload, dict) and payload.get("title") else None


def _youtube_has_motion(video_id: str) -> bool | None:
    """Use YouTube's storyboard samples to reject still-image uploads cheaply."""
    try:
        raw = _request(f"https://i.ytimg.com/sb/{video_id}/storyboard3_L2/M0.jpg", timeout=2.5)
        with Image.open(io.BytesIO(raw)) as source:
            image = source.convert("L")
            if image.width < 50 or image.height < 50: return None
            tile_width = image.width // 5
            tile_height = image.height // 5
            frames = [
                image.crop((column * tile_width, row * tile_height,
                            (column + 1) * tile_width, (row + 1) * tile_height)).resize((32, 18))
                for row in range(5)
                for column in range(5)
            ]
    except (OSError, UnidentifiedImageError, ValueError):
        return None
    changes = []
    for previous, current in zip(frames, frames[1:], strict=False):
        difference = sum(
            abs(left - right)
            for left, right in zip(previous.getdata(), current.getdata(), strict=True)
        )
        changes.append(difference / (32 * 18))
    # Compression creates tiny changes even for a still image. A real clip
    # should contain several clearly different consecutive storyboard frames.
    return sum(change >= 4.0 for change in changes) >= 3


def _youtube_video_is_acceptable(video_id: str, title: str, artist: str | None) -> bool | None:
    try:
        metadata = _youtube_oembed(video_id)
    except Exception:
        return None
    acceptable = bool(metadata and _candidate_score(
        str(metadata.get("title", "")),
        str(metadata.get("author_name", "")),
        title,
        artist,
    ) is not None)
    return acceptable and _youtube_has_motion(video_id) is not False


def _youtube_video_id(title: str, artist: str | None) -> str | None:
    query = " ".join(value for value in (artist, title, "official music video") if value).strip()
    if not query: return None
    api_key = os.getenv("YOUTUBE_API_KEY", "").strip()
    if api_key:
        url = "https://www.googleapis.com/youtube/v3/search?" + urllib.parse.urlencode({
            "part": "snippet",
            "q": query,
            "type": "video",
            "videoEmbeddable": "true",
            "videoCategoryId": "10",
            "maxResults": 8,
            "key": api_key,
        })
        payload = json.loads(_request(url).decode("utf-8"))
        items = payload.get("items", []) if isinstance(payload, dict) else []
        ranked = []
        for item in items:
            video_id = item.get("id", {}).get("videoId") if isinstance(item, dict) else None
            snippet = item.get("snippet", {}) if isinstance(item, dict) else {}
            if not isinstance(video_id, str) or not _PLAIN_YOUTUBE_ID_RE.fullmatch(video_id): continue
            score = _candidate_score(
                str(snippet.get("title", "")),
                str(snippet.get("channelTitle", "")),
                title,
                artist,
            )
            if score is not None: ranked.append((score, video_id))
        for _, video_id in sorted(ranked, reverse=True):
            if _youtube_video_is_acceptable(video_id, title, artist) is True: return video_id

    # Keyless fallback keeps local installations useful. It stores only the
    # public video id and streams through YouTube's muted embed player; no
    # copyrighted video file is copied into the song library.
    url = "https://www.youtube.com/results?" + urllib.parse.urlencode({"search_query": query})
    page = html.unescape(_request(url).decode("utf-8", errors="ignore"))
    candidates = list(dict.fromkeys(_YOUTUBE_ID_RE.findall(page)))[:8]
    ranked = []
    for video_id in candidates:
        try:
            metadata = _youtube_oembed(video_id)
        except Exception:
            continue
        if not metadata: continue
        score = _candidate_score(
            str(metadata.get("title", "")),
            str(metadata.get("author_name", "")),
            title,
            artist,
        )
        if score is not None: ranked.append((score, video_id))
    for _, video_id in sorted(ranked, reverse=True):
        if _youtube_has_motion(video_id) is not False: return video_id
    return None


def enrich_song(song_id: str) -> None:
    db = SessionLocal()
    try:
        song = repositories.get_song(db, song_id)
        if song is None: return
        genre = None
        video_id = None
        video_changed = False
        try:
            if not song.genre: genre = _itunes_genre(song.title, song.artist)
        except Exception as exc:  # Network metadata is optional.
            logger.info("Genre lookup skipped for %s: %s", song_id, exc)
        try:
            existing_id = _youtube_id_from_url(song.video_url)
            if existing_id and song.video_url not in _validated_video_urls:
                quality = _youtube_video_is_acceptable(existing_id, song.title, song.artist)
                if quality is True:
                    _validated_video_urls.add(song.video_url)
                elif quality is False:
                    song.video_url = None
                    video_changed = True
            if not song.video_url: video_id = _youtube_video_id(song.title, song.artist)
        except Exception as exc:  # Network metadata is optional.
            logger.info("Music video lookup skipped for %s: %s", song_id, exc)
        if genre and not song.genre: song.genre = genre
        if video_id and not song.video_url:
            song.video_url = f"https://www.youtube.com/watch?v={video_id}"
            _validated_video_urls.add(song.video_url)
            video_changed = True
        if genre or video_changed:
            commit(db)
            revision_cache.invalidate(song)
    finally:
        db.close()
        with _lock: _active.discard(song_id)


def enqueue(song_id: str) -> bool:
    with _lock:
        if song_id in _active: return False
        _active.add(song_id)
    threading.Thread(
        target=enrich_song,
        args=(song_id,),
        name=f"metadata-{song_id[:8]}",
        daemon=True,
    ).start()
    return True


def enqueue_missing(limit: int = 8) -> int:
    db = SessionLocal()
    try:
        songs = list(db.scalars(
            select(models.Song)
            .where(models.Song.status == models.SongStatus.DONE)
            .order_by(models.Song.updated_at.desc())
            .limit(max(0, limit * 4))
        ))
    finally:
        db.close()
    song_ids = [
        song.id for song in songs
        if (
            not song.genre
            or not song.video_url
            or (
                _youtube_id_from_url(song.video_url)
                and song.video_url not in _validated_video_urls
            )
        )
    ][:max(0, limit)]
    return sum(enqueue(song_id) for song_id in song_ids)
