"""Запись голоса пользователя."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from app.services import song_service, recording_service, audio_service

router = APIRouter(prefix="/recording", tags=["recording"])


@router.get("/settings", response_model=schemas.AudioSettingsOut)
def get_recording_settings(db: Session = Depends(get_db)):
    return audio_service.get_settings(db)


@router.post("/start", response_model=schemas.RecordingStartOut)
def start_recording(body: schemas.RecordingStartRequest, db: Session = Depends(get_db)):
    song = song_service.get_song(db, body.song_id)
    if song is None:
        raise HTTPException(status_code=404, detail="Песня не найдена")

    settings = audio_service.get_settings(db)
    try:
        session_id = recording_service.start_recording(
            song_id=song.id, device_id=settings.input_device_id,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return schemas.RecordingStartOut(recording_session_id=session_id, message="Запись начата")


@router.post("/stop", response_model=schemas.RecordingOut)
def stop_recording(session_id: str):
    try:
        recording = recording_service.stop_recording(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return recording


@router.get("/by-song/{song_id}", response_model=list[schemas.RecordingOut])
def list_recordings_for_song(song_id: str, db: Session = Depends(get_db)):
    if song_service.get_song(db, song_id) is None:
        raise HTTPException(status_code=404, detail="Song not found")
    return (
        db.query(models.Recording)
        .filter(models.Recording.song_id == song_id)
        .order_by(models.Recording.created_at.desc())
        .all()
    )


@router.get("/{recording_id}", response_model=schemas.RecordingOut)
def get_recording(recording_id: str, db: Session = Depends(get_db)):
    recording = db.query(models.Recording).filter(models.Recording.id == recording_id).first()
    if recording is None:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    return recording


@router.get("/{recording_id}/file")
def get_recording_file(recording_id: str, db: Session = Depends(get_db)):
    recording = db.query(models.Recording).filter(models.Recording.id == recording_id).first()
    if recording is None:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    return FileResponse(recording.path, media_type="audio/wav", filename=recording.filename)


@router.delete("/{recording_id}", status_code=204)
def delete_recording(recording_id: str, db: Session = Depends(get_db)):
    recording = db.query(models.Recording).filter(models.Recording.id == recording_id).first()
    if recording is None:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    recording_service.delete_recording(db, recording)
