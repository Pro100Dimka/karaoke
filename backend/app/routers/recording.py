"""Запись голоса пользователя."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

import schemas
from app import repositories
from app.api.dependencies import DatabaseSession, RecordingDependency, SongDependency
from app.services import audio_service, recording_service
from database import get_db

router = APIRouter(prefix="/recording", tags=["recording"])


def _change_session_state(session_id: str, action, status: str) -> dict[str, str]:
    try:
        action(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": status}


def _restore_monitoring(db: Session) -> None:
    """Restore persisted monitoring without hiding an already completed action."""
    try:
        audio_service.configure_monitoring(audio_service.get_settings(db))
    except RuntimeError:
        audio_service.stop_monitoring()


def _configure_recording_monitor(settings, body: schemas.RecordingStartRequest) -> bool:
    """Prepare monitoring and return whether ASIO uses a temporary native monitor."""
    keep_native_monitor = settings.audio_driver == "asio"
    if not keep_native_monitor:
        audio_service.stop_monitoring()
        return False

    transient_values = {
        name: getattr(settings, name)
        for name in ("monitoring_enabled", "volume", "reverb", "echo", "delay")
    }
    settings.monitoring_enabled = True
    settings.volume = body.microphone_volume
    settings.reverb = body.reverb
    settings.echo = body.echo
    settings.delay = body.delay
    try:
        audio_service.configure_monitoring(settings)
    finally:
        for name, value in transient_values.items():
            setattr(settings, name, value)
    return True


@router.get("/settings", response_model=schemas.AudioSettingsOut)
def get_recording_settings(db: Session = Depends(get_db)):
    return audio_service.get_settings(db)


@router.post("/start", response_model=schemas.RecordingStartOut)
def start_recording(body: schemas.RecordingStartRequest, db: DatabaseSession):
    song = repositories.get_song(db, body.song_id)
    if song is None:
        raise HTTPException(status_code=404, detail="Песня не найдена")
    settings = audio_service.get_settings(db)
    try:
        keep_native_monitor = _configure_recording_monitor(settings, body)
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
            gain=body.microphone_volume,
            monitoring_enabled=not keep_native_monitor,
            playback_offset_sec=body.position_sec,
            blocksize=settings.buffer_size,
            music_gain=body.music_volume,
            effects={"reverb": body.reverb, "echo": body.echo, "delay": body.delay},
        )
    except RuntimeError as exc:
        _restore_monitoring(db)
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return schemas.RecordingStartOut(recording_session_id=session_id, message="Запись начата")


@router.post("/pause")
def pause_recording(session_id: str):
    return _change_session_state(session_id, recording_service.pause_recording, "paused")


@router.post("/resume")
def resume_recording(session_id: str):
    return _change_session_state(session_id, recording_service.resume_recording, "recording")


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
    _restore_monitoring(db)
    return recording


@router.get("/by-song/{song_id}", response_model=list[schemas.RecordingOut])
def list_recordings_for_song(song: SongDependency, db: Session = Depends(get_db)):
    return repositories.list_recordings_for_song(db, song.id)


@router.get("/library", response_model=list[schemas.RecordedSongOut])
def list_recording_library(db: Session = Depends(get_db)):
    rows = repositories.list_recording_library(db)
    return [
        {**schemas.RecordingOut.model_validate(recording).model_dump(), "song_title": title}
        for recording, title in rows
    ]


@router.get("/{recording_id}", response_model=schemas.RecordingOut)
def get_recording(recording: RecordingDependency):
    return recording


@router.get("/{recording_id}/file")
def get_recording_file(recording: RecordingDependency):
    path = recording_service.resolve_recording_path(recording)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Файл записи не найден")
    return FileResponse(path, media_type="audio/wav", filename=recording.filename)


@router.get("/{recording_id}/performance")
def get_performance_file(recording: RecordingDependency):
    for mixed_path in recording_service.performance_mix_paths(recording):
        if mixed_path.is_file():
            media_type = "audio/mpeg" if mixed_path.suffix == ".mp3" else "audio/wav"
            return FileResponse(mixed_path, media_type=media_type, filename=mixed_path.name)
    path = recording_service.resolve_recording_path(recording)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Файл записи не найден")
    return FileResponse(path, media_type="audio/wav", filename=recording.filename)


@router.delete("/{recording_id}", status_code=204)
def delete_recording(recording: RecordingDependency, db: DatabaseSession):
    recording_service.delete_recording(db, recording)
