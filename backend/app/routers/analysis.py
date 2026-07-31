"""Анализ голоса: сравнение записи пользователя с эталонной мелодией."""
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from app.services import analysis_service

router = APIRouter(prefix="/analysis", tags=["analysis"])


def _get_recording_or_404(recording_id: str, db: Session) -> models.Recording:
    recording = db.query(models.Recording).filter(models.Recording.id == recording_id).first()
    if recording is None:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    return recording


def _to_out(result: models.AnalysisResult) -> schemas.AnalysisOut:
    sections = json.loads(result.sections_json) if result.sections_json else None
    return schemas.AnalysisOut(
        id=result.id,
        recording_id=result.recording_id,
        pitch_accuracy_percent=result.pitch_accuracy_percent,
        mean_deviation_semitones=result.mean_deviation_semitones,
        sections=sections,
        created_at=result.created_at,
    )


@router.post("/{recording_id}/run", response_model=schemas.AnalysisOut)
def run_analysis(recording_id: str, db: Session = Depends(get_db)):
    recording = _get_recording_or_404(recording_id, db)
    song = db.query(models.Song).filter(models.Song.id == recording.song_id).first()
    if song is None:
        raise HTTPException(status_code=404, detail="Песня для этой записи не найдена")

    try:
        analysis = analysis_service.analyze_recording(recording, song)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    existing = db.query(models.AnalysisResult).filter(
        models.AnalysisResult.recording_id == recording_id
    ).first()
    sections_json = json.dumps(analysis["sections"], ensure_ascii=False) if analysis["sections"] else None

    if existing:
        existing.pitch_accuracy_percent = analysis["pitch_accuracy_percent"]
        existing.mean_deviation_semitones = analysis["mean_deviation_semitones"]
        existing.sections_json = sections_json
        result = existing
    else:
        result = models.AnalysisResult(
            recording_id=recording_id,
            pitch_accuracy_percent=analysis["pitch_accuracy_percent"],
            mean_deviation_semitones=analysis["mean_deviation_semitones"],
            sections_json=sections_json,
        )
        db.add(result)

    db.commit()
    db.refresh(result)
    return _to_out(result)


@router.get("/{recording_id}", response_model=schemas.AnalysisOut)
def get_analysis(recording_id: str, db: Session = Depends(get_db)):
    result = db.query(models.AnalysisResult).filter(
        models.AnalysisResult.recording_id == recording_id
    ).first()
    if result is None:
        raise HTTPException(status_code=404, detail="Анализ ещё не выполнялся для этой записи")
    return _to_out(result)


@router.get("/{recording_id}/accuracy")
def get_accuracy(recording_id: str, db: Session = Depends(get_db)):
    result = db.query(models.AnalysisResult).filter(
        models.AnalysisResult.recording_id == recording_id
    ).first()
    if result is None:
        raise HTTPException(status_code=404, detail="Анализ ещё не выполнялся для этой записи")
    return {"pitch_accuracy_percent": result.pitch_accuracy_percent}


@router.get("/{recording_id}/deviation")
def get_deviation(recording_id: str, db: Session = Depends(get_db)):
    result = db.query(models.AnalysisResult).filter(
        models.AnalysisResult.recording_id == recording_id
    ).first()
    if result is None:
        raise HTTPException(status_code=404, detail="Анализ ещё не выполнялся для этой записи")
    return {"mean_deviation_semitones": result.mean_deviation_semitones}


@router.get("/{recording_id}/sections")
def get_sections(recording_id: str, db: Session = Depends(get_db)):
    result = db.query(models.AnalysisResult).filter(
        models.AnalysisResult.recording_id == recording_id
    ).first()
    if result is None:
        raise HTTPException(status_code=404, detail="Анализ ещё не выполнялся для этой записи")
    return {"sections": json.loads(result.sections_json) if result.sections_json else None}
