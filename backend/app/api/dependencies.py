"""Reusable FastAPI dependencies for loading domain entities."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

import models
from app import repositories
from database import get_db

DatabaseSession = Annotated[Session, Depends(get_db)]


def _require(loader, db, identifier, detail):
    if (item := loader(db, identifier)) is None: raise HTTPException(status_code=404, detail=detail)
    return item


def require_song(song_id: str, db: DatabaseSession) -> models.Song: return _require(repositories.get_song, db, song_id, 'Песня не найдена')


def require_recording(recording_id: str, db: DatabaseSession) -> models.Recording: return _require(repositories.get_recording, db, recording_id, 'Запись не найдена')


def require_analysis(recording_id: str, db: DatabaseSession) -> models.AnalysisResult: return _require(repositories.get_analysis_by_recording, db, recording_id, 'Анализ ещё не выполнялся для этой записи')


SongDependency = Annotated[models.Song, Depends(require_song)]
RecordingDependency = Annotated[models.Recording, Depends(require_recording)]
AnalysisDependency = Annotated[models.AnalysisResult, Depends(require_analysis)]
