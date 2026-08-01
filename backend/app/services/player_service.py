"""
Караоке-плеер: backend не проигрывает звук сам (это делает клиент), но
хранит текущее состояние воспроизведения (позиция, играет/на паузе), чтобы
разные части UI (текст, ноты, таймлайн) сверялись с одним источником
правды, и отдаёт данные синхронизации, собранные AI-пайплайном.
"""
import json
from pathlib import Path

from sqlalchemy.orm import Session

import models


def _read_json(path: Path):
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def get_sync_data(song: models.Song) -> dict:
    """Собирает всё, что нужно клиенту для синхронного показа текста/нот
    во время воспроизведения: карту песни, текст с таймингами, ноты."""
    if not song.output_dir:
        return {}
    out_dir = Path(song.output_dir)
    return {
        "lyrics": _read_json(out_dir / "lyrics.json"),
        "structure": _read_json(out_dir / "structure.json"),
        "music": _read_json(out_dir / "music.json"),
        "breaths": _read_json(out_dir / "breaths.json"),
    }


def get_timeline(song: models.Song) -> dict:
    if not song.output_dir:
        return {}
    out_dir = Path(song.output_dir)
    return {
        "structure": _read_json(out_dir / "structure.json"),
        "song_info": _read_json(out_dir / "songInfo.json"),
    }


def _get_or_create_state(db: Session, song_id: str) -> models.PlaybackState:
    state = db.query(models.PlaybackState).filter(models.PlaybackState.song_id == song_id).first()
    if state is None:
        state = models.PlaybackState(song_id=song_id, position_sec=0.0, is_playing=False)
        db.add(state)
        db.commit()
        db.refresh(state)
    return state


def get_state(db: Session, song_id: str) -> models.PlaybackState:
    return _get_or_create_state(db, song_id)


def seek(db: Session, song_id: str, position_sec: float) -> models.PlaybackState:
    state = _get_or_create_state(db, song_id)
    state.position_sec = max(0.0, position_sec)
    db.commit()
    db.refresh(state)
    return state


def set_playing(db: Session, song_id: str, is_playing: bool) -> models.PlaybackState:
    state = _get_or_create_state(db, song_id)
    state.is_playing = is_playing
    db.commit()
    db.refresh(state)
    return state


def stop(db: Session, song_id: str) -> models.PlaybackState:
    state = _get_or_create_state(db, song_id)
    state.is_playing = False
    state.position_sec = 0.0
    db.commit()
    db.refresh(state)
    return state
