"""Application-level endpoints used by the desktop shell."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import config
import models
from database import get_db

router = APIRouter(tags=["application"])

_SETTINGS_FILE = config.DATA_DIR / "settings.json"
_DEFAULT_SETTINGS = {
    "language": "ru",
    "theme": "dark",
    "whisper_model": config.DEFAULT_WHISPER_MODEL,
    "thread_count": 4,
    "use_gpu": True,
    "use_cpu": True,
    "autosave": True,
    "autoupdate": False,
}


class AppSettingsPatch(BaseModel):
    language: str | None = None
    theme: str | None = None
    whisper_model: str | None = None
    thread_count: int | None = Field(default=None, ge=1, le=64)
    use_gpu: bool | None = None
    use_cpu: bool | None = None
    autosave: bool | None = None
    autoupdate: bool | None = None


def _read_settings() -> dict[str, Any]:
    try:
        stored = json.loads(_SETTINGS_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        stored = {}
    return {**_DEFAULT_SETTINGS, **stored, **_path_settings()}


def _path_settings() -> dict[str, str]:
    return {
        "songs_folder": str(config.FULL_SONGS_DIR),
        "ai_folder": str(config.AI_DIR),
        "recordings_folder": str(config.SONG_OUTPUT_DIR),
        "cache_folder": str(config.DATA_DIR),
    }


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return _read_settings()


@router.patch("/settings")
def update_settings(patch: AppSettingsPatch) -> dict[str, Any]:
    data = {**_read_settings(), **patch.model_dump(exclude_none=True)}
    for key in _path_settings():
        data.pop(key, None)
    _SETTINGS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return _read_settings()


@router.get("/history")
def get_history(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for song in db.query(models.Song).all():
        items.append({
            "song_title": song.title,
            "kind": "processing",
            "status": song.status.value,
            "duration_seconds": None,
            "timestamp": song.updated_at.isoformat() if song.updated_at else None,
        })
    for recording, title, analysis_id in (
        db.query(models.Recording, models.Song.title, models.AnalysisResult.id)
        .join(models.Song, models.Recording.song_id == models.Song.id)
        .outerjoin(models.AnalysisResult, models.AnalysisResult.recording_id == models.Recording.id)
        .all()
    ):
        items.append({
            "song_title": title,
            "kind": "recording",
            "status": "analyzed" if analysis_id else "recorded",
            "duration_seconds": recording.duration_sec,
            "timestamp": recording.created_at.isoformat() if recording.created_at else None,
        })
    return sorted(items, key=lambda item: item["timestamp"] or "", reverse=True)


@router.get("/about")
def about() -> dict[str, str]:
    return {
        "name": "Karaoke Studio",
        "version": "0.1.0",
        "backend_version": "0.1.0",
        "generated_at": datetime.now().astimezone().isoformat(),
    }
