"""Микрофон и звук."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import schemas
from database import get_db
from app.services import audio_service

router = APIRouter(prefix="/audio", tags=["audio"])


@router.get("/devices", response_model=list[schemas.AudioDeviceOut])
def list_devices():
    return audio_service.list_input_devices()


@router.get("/settings", response_model=schemas.AudioSettingsOut)
def get_settings(db: Session = Depends(get_db)):
    return audio_service.get_settings(db)


@router.post("/settings", response_model=schemas.AudioSettingsOut)
def update_settings(patch: schemas.AudioSettingsUpdate, db: Session = Depends(get_db)):
    return audio_service.update_settings(db, patch.model_dump(exclude_unset=True))


@router.post("/devices/select", response_model=schemas.AudioSettingsOut)
def select_device(device_id: int, db: Session = Depends(get_db)):
    return audio_service.update_settings(db, {"input_device_id": device_id})


@router.get("/signal-quality", response_model=schemas.SignalQualityOut)
def signal_quality(db: Session = Depends(get_db)):
    settings = audio_service.get_settings(db)
    try:
        return audio_service.check_signal_quality(settings.input_device_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
