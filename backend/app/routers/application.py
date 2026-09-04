"""Application-level endpoints used by the desktop shell."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import models
from app.api.errors import http_error
from app.services import app_settings_service, diagnostics_service, remote_log_service, song_service
from database import get_db

router = APIRouter(tags=["application"])


class AppSettingsPatch(BaseModel):
    language: Literal["uk", "ru", "en"] | None = None
    theme: Literal["dark", "light", "green", "violet"] | None = None
    thread_count: int | None = Field(default=None, ge=1, le=64)
    compute_mode: Literal["auto", "cuda", "cpu"] | None = None
    online_name: str | None = Field(default=None, max_length=40)
    keyboard_lighting_enabled: bool | None = None
    keyboard_lighting_mode: Literal["music", "theme"] | None = None
    keyboard_lighting_brightness: float | None = Field(default=None, ge=0, le=1)
    keyboard_lighting_sensitivity: float | None = Field(default=None, ge=0.25, le=2)
    remote_diagnostics_enabled: bool | None = None
    remote_diagnostics_errors_enabled: bool | None = None
    remote_diagnostics_hardware_enabled: bool | None = None
    remote_crash_reports_enabled: bool | None = None
    songs_folder: str | None = Field(default=None, max_length=4096)
    ai_folder: str | None = Field(default=None, max_length=4096)
    cache_folder: str | None = Field(default=None, max_length=4096)


@router.get("/settings")
def get_settings() -> dict:
    return app_settings_service.read_settings()


@router.patch("/settings")
def update_settings(patch: AppSettingsPatch) -> dict:
    with http_error(ValueError, 422): return app_settings_service.update_settings(patch.model_dump(exclude_none=True))


@router.get("/settings/remote-diagnostics")
def remote_diagnostics_policy() -> dict:
    return remote_log_service.diagnostics_policy_preview()


@router.delete("/settings/remote-diagnostics")
def delete_remote_diagnostics() -> dict:
    if not remote_log_service.delete_remote_diagnostics():
        raise HTTPException(status_code=503, detail="Could not delete remote diagnostics")
    settings = app_settings_service.update_settings(
        {
            "remote_diagnostics_enabled": False,
            "remote_diagnostics_errors_enabled": False,
            "remote_diagnostics_hardware_enabled": False,
            "remote_crash_reports_enabled": False,
        }
    )
    return {"deleted": True, "settings": settings}


@router.get("/preferences")
def get_ui_preferences() -> dict[str, dict[str, Any]]:
    return app_settings_service.read_ui_preferences()


@router.patch("/preferences/{namespace}")
def update_ui_preferences(namespace: str, patch: dict[str, Any]) -> dict[str, Any]:
    with http_error(ValueError, 422): return app_settings_service.update_ui_preferences(namespace, patch)


HISTORY_LIMIT = 50


@router.get("/history")
def get_history(db: Session = Depends(get_db)) -> list[dict]:
    # This backs a simple recent-activity list (no pagination UI, polled
    # every few seconds), so it only ever needs to show the most recent
    # HISTORY_LIMIT entries -- fetching (and DB-side sorting/limiting) just
    # that many from each source instead of every song/recording the library
    # has ever had keeps the query and the response bounded regardless of
    # how large the library grows.
    items = [
        {"song_title": song.title, "kind": "processing", "status": song.status.value, "duration_seconds": None, "timestamp": song.updated_at.isoformat() if song.updated_at else None}
        for song in song_service.list_recently_updated_songs(db, HISTORY_LIMIT)
    ]
    items += [
        {"song_title": title, "kind": "recording", "status": "analyzed" if analysis_id else "recorded", "duration_seconds": recording.duration_sec, "timestamp": recording.created_at.isoformat() if recording.created_at else None}
        for recording, title, analysis_id in db.query(models.Recording, models.Song.title, models.AnalysisResult.id).join(models.Song, models.Recording.song_id == models.Song.id).outerjoin(models.AnalysisResult, models.AnalysisResult.recording_id == models.Recording.id).order_by(models.Recording.created_at.desc()).limit(HISTORY_LIMIT).all()
    ]
    return sorted(items, key=lambda item: item["timestamp"] or "", reverse=True)[:HISTORY_LIMIT]


@router.get("/about")
def about() -> dict[str, str]:
    return {
        "name": "A&D Voice",
        "version": diagnostics_service.BACKEND_VERSION,
        "backend_version": diagnostics_service.BACKEND_VERSION,
        "build_id": diagnostics_service.BUILD_ID,
        "generated_at": datetime.now().astimezone().isoformat(),
    }
