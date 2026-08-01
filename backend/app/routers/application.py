"""Application-level endpoints used by the desktop shell."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import models
from app.services import app_settings_service
from database import get_db

router = APIRouter(tags=["application"])


class AppSettingsPatch(BaseModel):
    language: Literal["ru", "en"] | None = None
    theme: Literal["dark", "light"] | None = None
    whisper_model: (
        Literal["tiny", "base", "small", "medium", "large", "turbo", "large-v3-turbo"] | None
    ) = None
    thread_count: int | None = Field(default=None, ge=1, le=64)
    use_gpu: bool | None = None
    use_cpu: bool | None = None
    autosave: bool | None = None
    autoupdate: bool | None = None


@router.get("/settings")
def get_settings() -> dict:
    return app_settings_service.read_settings()


@router.patch("/settings")
def update_settings(patch: AppSettingsPatch) -> dict:
    return app_settings_service.update_settings(patch.model_dump(exclude_none=True))


@router.get("/history")
def get_history(db: Session = Depends(get_db)) -> list[dict]:
    items: list[dict] = []
    for song in db.query(models.Song).all():
        items.append(
            {
                "song_title": song.title,
                "kind": "processing",
                "status": song.status.value,
                "duration_seconds": None,
                "timestamp": song.updated_at.isoformat() if song.updated_at else None,
            }
        )
    for recording, title, analysis_id in (
        db.query(models.Recording, models.Song.title, models.AnalysisResult.id)
        .join(models.Song, models.Recording.song_id == models.Song.id)
        .outerjoin(models.AnalysisResult, models.AnalysisResult.recording_id == models.Recording.id)
        .all()
    ):
        items.append(
            {
                "song_title": title,
                "kind": "recording",
                "status": "analyzed" if analysis_id else "recorded",
                "duration_seconds": recording.duration_sec,
                "timestamp": recording.created_at.isoformat() if recording.created_at else None,
            }
        )
    return sorted(items, key=lambda item: item["timestamp"] or "", reverse=True)


@router.get("/about")
def about() -> dict[str, str]:
    return {
        "name": "Karaoke Studio",
        "version": "0.1.0",
        "backend_version": "0.1.0",
        "generated_at": datetime.now().astimezone().isoformat(),
    }
