"""Запись голоса пользователя."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

import models
import schemas
from app.services import audio_service, recording_service, song_service
from database import get_db

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
        # Karaoke playback always monitors the microphone. The checkbox only
        # controls whether it is also monitored *before* Play. For ASIO, start
        # a temporary native monitor without persisting that automatic choice;
        # it is stopped again after the take if the checkbox was not selected.
        keep_native_monitor = settings.audio_driver == "asio"
        if keep_native_monitor:
            saved_monitoring_preference = settings.monitoring_enabled
            settings.monitoring_enabled = True
            try:
                audio_service.configure_monitoring(settings)
            finally:
                settings.monitoring_enabled = saved_monitoring_preference
        else:
            audio_service.stop_monitoring()
        input_device_id = audio_service.preferred_input_device(
            settings.input_device_id,
            settings.audio_driver,
            settings.asio_driver_name,
        )
        session_id = recording_service.start_recording(
            song_id=song.id,
            device_id=input_device_id,
            output_device_id=audio_service.preferred_output_device(
                input_device_id,
                settings.audio_driver,
                settings.output_device_id,
                settings.asio_driver_name,
            ),
            sample_rate=audio_service.preferred_sample_rate(
                input_device_id,
                settings.audio_driver,
            ),
            gain=settings.volume,
            monitoring_enabled=not keep_native_monitor,
            playback_offset_sec=body.position_sec,
            blocksize=settings.buffer_size,
            music_gain=body.music_volume,
            vocal_gain=body.vocal_volume,
        )
    except RuntimeError as exc:
        # A temporary ASIO monitor is started for karaoke playback. If opening
        # the recording stream fails, restore the persisted preference so the
        # microphone does not remain audible without an active recording.
        try:
            audio_service.configure_monitoring(audio_service.get_settings(db))
        except RuntimeError:
            audio_service.stop_monitoring()
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return schemas.RecordingStartOut(recording_session_id=session_id, message="Запись начата")


@router.post("/pause")
def pause_recording(session_id: str):
    try:
        recording_service.pause_recording(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "paused"}


@router.post("/resume")
def resume_recording(session_id: str):
    try:
        recording_service.resume_recording(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "recording"}


@router.post("/stop", response_model=schemas.RecordingOut)
def stop_recording(session_id: str, db: Session = Depends(get_db)):
    try:
        recording = recording_service.stop_recording(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not save recording: {exc}") from exc
    audio_service.configure_monitoring(audio_service.get_settings(db))
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


@router.get("/library", response_model=list[schemas.RecordedSongOut])
def list_recording_library(db: Session = Depends(get_db)):
    rows = (
        db.query(models.Recording, models.Song.title)
        .join(models.Song, models.Recording.song_id == models.Song.id)
        .order_by(models.Recording.created_at.desc())
        .all()
    )
    return [
        {**schemas.RecordingOut.model_validate(recording).model_dump(), "song_title": title}
        for recording, title in rows
    ]


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


@router.get("/{recording_id}/performance")
def get_performance_file(recording_id: str, db: Session = Depends(get_db)):
    recording = db.query(models.Recording).filter(models.Recording.id == recording_id).first()
    if recording is None:
        raise HTTPException(status_code=404, detail="Recording not found")
    mixed_path = recording_service.performance_mix_path(recording)
    if mixed_path.is_file():
        return FileResponse(mixed_path, media_type="audio/mpeg", filename=mixed_path.name)
    return FileResponse(recording.path, media_type="audio/wav", filename=recording.filename)


@router.delete("/{recording_id}", status_code=204)
def delete_recording(recording_id: str, db: Session = Depends(get_db)):
    recording = db.query(models.Recording).filter(models.Recording.id == recording_id).first()
    if recording is None:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    recording_service.delete_recording(db, recording)
