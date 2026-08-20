
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
from app import repositories
from app.services import ai_bridge, song_service
from app.services.db_utils import commit_refresh
from app.utils.json_files import read_json


def get_sync_data(song: models.Song) -> dict:
    if not song.output_dir: return {}
    out_dir = song_service.resolve_output_dir(song)
    lyrics = ai_bridge.get_karaoke_lyrics(out_dir)
    if not lyrics:
        return {
            "lyrics": read_json(out_dir / "lyrics.json"),
            "structure": read_json(out_dir / "structure.json"),
            "music": read_json(out_dir / "music.json"),
            "breaths": read_json(out_dir / "breaths.json"),
        }
    duration = float(lyrics.get("duration") or 0.0) if isinstance(lyrics, dict) else 0.0
    return {
        "lyrics": lyrics,
        "structure": [{"label": "Песня", "name": "song", "start": 0.0, "end": duration}] if duration else [],
        "music": {key: lyrics.get(key) for key in ("bpm", "key", "duration")} if isinstance(lyrics, dict) else {},
        "breaths": [],
    }


def get_timeline(song: models.Song) -> dict:
    if not song.output_dir: return {}
    out_dir = song_service.resolve_output_dir(song)
    if not (out_dir / "lyricsSync.json").is_file():
        return {"structure": read_json(out_dir / "structure.json"), "song_info": read_json(out_dir / "songInfo.json")}
    timeline = ai_bridge.get_karaoke_timeline(out_dir)
    return {"structure": get_sync_data(song)["structure"], "song_info": timeline}


def _get_or_create_state(db: Session, song_id: str) -> models.PlaybackState:
    if (state := repositories.get_playback_state(db, song_id)) is not None: return state

    state = models.PlaybackState(song_id=song_id, position_sec=0.0, is_playing=False)
    db.add(state)
    try:
        return commit_refresh(db, state)
    except IntegrityError:
        db.rollback()
        existing = repositories.get_playback_state(db, song_id)
        if existing is None: raise
        return existing


def get_state(db: Session, song_id: str) -> models.PlaybackState: return _get_or_create_state(db, song_id)


def seek(db: Session, song_id: str, position_sec: float) -> models.PlaybackState:
    state = _get_or_create_state(db, song_id)
    state.position_sec = max(0.0, position_sec)
    return commit_refresh(db, state)


def set_playing(db: Session, song_id: str, is_playing: bool) -> models.PlaybackState:
    state = _get_or_create_state(db, song_id)
    state.is_playing = is_playing
    return commit_refresh(db, state)


def stop(db: Session, song_id: str) -> models.PlaybackState:
    state = _get_or_create_state(db, song_id)
    state.is_playing = False
    state.position_sec = 0.0
    return commit_refresh(db, state)
