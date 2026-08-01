"""Микрофон и звук."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import schemas
from app.services import audio_service
from database import get_db

router = APIRouter(prefix="/audio", tags=["audio"])


@router.get("/devices", response_model=list[schemas.AudioDeviceOut])
def list_devices():
    return audio_service.list_input_devices()


@router.get("/output-devices", response_model=list[schemas.AudioOutputDeviceOut])
def list_output_devices():
    return audio_service.list_output_devices()


@router.get("/asio-drivers", response_model=list[schemas.AsioDriverOut])
def list_asio_drivers():
    return [{"name": name} for name in audio_service.list_asio_drivers()]


@router.get("/settings", response_model=schemas.AudioSettingsOut)
def get_settings(db: Session = Depends(get_db)):
    return audio_service.get_settings(db)


@router.post("/settings", response_model=schemas.AudioSettingsOut)
def update_settings(patch: schemas.AudioSettingsUpdate, db: Session = Depends(get_db)):
    try:
        return audio_service.update_settings(db, patch.model_dump(exclude_unset=True))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/direct-monitor/start", response_model=schemas.AudioSettingsOut)
def start_direct_monitoring(db: Session = Depends(get_db)):
    settings = audio_service.get_settings(db)
    settings.monitoring_enabled = True
    db.commit()
    db.refresh(settings)
    try:
        audio_service.configure_monitoring(settings)
    except RuntimeError as exc:
        settings.monitoring_enabled = False
        db.commit()
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return settings


@router.post("/direct-monitor/stop", response_model=schemas.AudioSettingsOut)
def stop_direct_monitoring(db: Session = Depends(get_db)):
    settings = audio_service.get_settings(db)
    audio_service.stop_monitoring()
    settings.monitoring_enabled = False
    db.commit()
    db.refresh(settings)
    return settings


@router.post("/devices/select", response_model=schemas.AudioSettingsOut)
def select_device(device_id: int, db: Session = Depends(get_db)):
    return audio_service.update_settings(db, {"input_device_id": device_id})


@router.get("/signal-quality", response_model=schemas.SignalQualityOut)
def signal_quality(db: Session = Depends(get_db)):
    settings = audio_service.get_settings(db)
    try:
        return audio_service.check_signal_quality(
            settings.input_device_id,
            gain=settings.volume,
            monitoring_expected=settings.monitoring_enabled,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
