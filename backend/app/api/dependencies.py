"""Reusable FastAPI dependencies for loading domain entities."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

import models
from app import repositories
from database import get_db

DatabaseSession = Annotated[Session, Depends(get_db)]


def require_song(song_id: str, db: DatabaseSession) -> models.Song:
    song = repositories.get_song(db, song_id)
    if song is None:
        raise HTTPException(status_code=404, detail="Песня не найдена")
    return song


def require_recording(recording_id: str, db: DatabaseSession) -> models.Recording:
    recording = repositories.get_recording(db, recording_id)
    if recording is None:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    return recording


def require_analysis(recording_id: str, db: DatabaseSession) -> models.AnalysisResult:
    result = repositories.get_analysis_by_recording(db, recording_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Анализ ещё не выполнялся для этой записи")
    return result


SongDependency = Annotated[models.Song, Depends(require_song)]
RecordingDependency = Annotated[models.Recording, Depends(require_recording)]
AnalysisDependency = Annotated[models.AnalysisResult, Depends(require_analysis)]
