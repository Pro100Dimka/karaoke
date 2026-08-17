"""Voice-analysis endpoints."""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException
from sqlalchemy.exc import IntegrityError

import models
import schemas
from app import repositories
from app.api.dependencies import AnalysisDependency, DatabaseSession, RecordingDependency
from app.services import analysis_service
from app.utils.json_values import parse_json_value

router = APIRouter(prefix="/analysis", tags=["analysis"])


def _to_out(result: models.AnalysisResult) -> schemas.AnalysisOut:
    return schemas.AnalysisOut(
        id=result.id,
        recording_id=result.recording_id,
        pitch_accuracy_percent=result.pitch_accuracy_percent,
        mean_deviation_semitones=result.mean_deviation_semitones,
        sections=parse_json_value(result.sections_json, None),
        created_at=result.created_at,
    )


@router.post("/{recording_id}/run", response_model=schemas.AnalysisOut)
def run_analysis(recording: RecordingDependency, db: DatabaseSession):
    song = repositories.get_song(db, recording.song_id)
    if song is None:
        raise HTTPException(status_code=404, detail="Песня для этой записи не найдена")

    if (existing := repositories.get_analysis_by_recording(db, recording.id)) is not None:
        return _to_out(existing)

    try:
        analysis = analysis_service.analyze_recording(recording, song)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    result = models.AnalysisResult(
        recording_id=recording.id,
        pitch_accuracy_percent=analysis["pitch_accuracy_percent"],
        mean_deviation_semitones=analysis["mean_deviation_semitones"],
        sections_json=(
            json.dumps(analysis["sections"], ensure_ascii=False) if analysis["sections"] else None
        ),
    )
    db.add(result)
    try:
        db.commit()
        db.refresh(result)
    except IntegrityError:
        db.rollback()
        stored_result = repositories.get_analysis_by_recording(db, recording.id)
        if stored_result is None:
            raise
        result = stored_result
    except Exception:
        db.rollback()
        raise
    return _to_out(result)


@router.get("/{recording_id}", response_model=schemas.AnalysisOut)
def get_analysis(result: AnalysisDependency):
    return _to_out(result)


@router.get("/{recording_id}/accuracy")
def get_accuracy(result: AnalysisDependency):
    return {"pitch_accuracy_percent": result.pitch_accuracy_percent}


@router.get("/{recording_id}/deviation")
def get_deviation(result: AnalysisDependency):
    return {"mean_deviation_semitones": result.mean_deviation_semitones}


@router.get("/{recording_id}/sections")
def get_sections(result: AnalysisDependency):
    return {"sections": parse_json_value(result.sections_json, None)}
