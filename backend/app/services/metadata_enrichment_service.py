"""Fast, optional song metadata enrichment outside the AI processing path."""

from __future__ import annotations

import html
import json
import logging
import os
import re
import threading
import urllib.parse
import urllib.request

from sqlalchemy import or_, select

import models
from app import repositories
from app.services import revision_cache
from app.services.db_utils import commit
from database import SessionLocal

logger = logging.getLogger(__name__)

_YOUTUBE_ID_RE = re.compile(r'"videoId":"([\w-]{11})"')
_PLAIN_YOUTUBE_ID_RE = re.compile(r"[\w-]{11}")
_active: set[str] = set()
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
            "maxResults": 1,
            "key": api_key,
        })
        payload = json.loads(_request(url).decode("utf-8"))
        items = payload.get("items", []) if isinstance(payload, dict) else []
        if items:
            video_id = items[0].get("id", {}).get("videoId")
            if isinstance(video_id, str) and _PLAIN_YOUTUBE_ID_RE.fullmatch(video_id):
                return video_id

    # Keyless fallback keeps local installations useful. It stores only the
    # public video id and streams through YouTube's muted embed player; no
    # copyrighted video file is copied into the song library.
    url = "https://www.youtube.com/results?" + urllib.parse.urlencode({"search_query": query})
    page = html.unescape(_request(url).decode("utf-8", errors="ignore"))
    match = _YOUTUBE_ID_RE.search(page)
    return match.group(1) if match else None


def enrich_song(song_id: str) -> None:
    db = SessionLocal()
    try:
        song = repositories.get_song(db, song_id)
        if song is None: return
        genre = None
        video_id = None
        try:
            if not song.genre: genre = _itunes_genre(song.title, song.artist)
        except Exception as exc:  # Network metadata is optional.
            logger.info("Genre lookup skipped for %s: %s", song_id, exc)
        try:
            if not song.video_url: video_id = _youtube_video_id(song.title, song.artist)
        except Exception as exc:  # Network metadata is optional.
            logger.info("Music video lookup skipped for %s: %s", song_id, exc)
        if genre and not song.genre: song.genre = genre
        if video_id and not song.video_url:
            song.video_url = f"https://www.youtube.com/watch?v={video_id}"
        if genre or video_id:
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
        song_ids = list(db.scalars(
            select(models.Song.id)
            .where(
                models.Song.status == models.SongStatus.DONE,
                or_(models.Song.genre.is_(None), models.Song.video_url.is_(None)),
            )
            .order_by(models.Song.updated_at.desc())
            .limit(max(0, limit))
        ))
    finally:
        db.close()
    return sum(enqueue(song_id) for song_id in song_ids)
