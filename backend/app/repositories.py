"""Centralized database lookups shared by services and API dependencies."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

import models


def get_song(db: Session, song_id: str) -> models.Song | None:
    return db.get(models.Song, song_id)


def get_recording(db: Session, recording_id: str) -> models.Recording | None:
    return db.get(models.Recording, recording_id)


def get_analysis_by_recording(db: Session, recording_id: str) -> models.AnalysisResult | None:
    return db.scalar(
        select(models.AnalysisResult).where(models.AnalysisResult.recording_id == recording_id)
    )


def get_playback_state(db: Session, song_id: str) -> models.PlaybackState | None:
    return db.get(models.PlaybackState, song_id)


def list_recordings_for_song(db: Session, song_id: str) -> list[models.Recording]:
    return list(
        db.scalars(
            select(models.Recording)
            .where(models.Recording.song_id == song_id)
            .order_by(models.Recording.created_at.desc())
        )
    )


def list_recording_library(db: Session) -> list[tuple[models.Recording, str]]:
    return list(
        db.execute(
            select(models.Recording, models.Song.title)
            .join(models.Song, models.Recording.song_id == models.Song.id)
            .order_by(models.Recording.created_at.desc())
        ).all()
    )
