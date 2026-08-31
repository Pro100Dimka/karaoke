"""Запись голоса пользователя."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

import models
import schemas
from app import repositories
from app.api.dependencies import DatabaseSession, RecordingDependency, SongDependency
from app.api.errors import http_error
from app.services import audio_service, pipeline_service, recording_service
from app.services.audio_runtime import serialized
from database import get_db

router = APIRouter(prefix="/recording", tags=["recording"])


def _change_session_state(session_id: str, action, status: str) -> dict[str, str]:
    with http_error(KeyError, 404): action(session_id)
    return {"status": status}


def _restore_monitoring(db: Session) -> None:
    try:
        audio_service.configure_monitoring(audio_service.get_settings(db))
    except RuntimeError:
        audio_service.stop_monitoring()


def _configure_recording_monitor(settings, body: schemas.RecordingStartRequest) -> bool:
    keep_native_monitor = settings.audio_driver == "asio"
    if not keep_native_monitor:
        audio_service.stop_monitoring()
        return False

    if not settings.monitoring_enabled:
        audio_service.stop_monitoring()
        return True

    transient_values = {
        name: (hasattr(settings, name), getattr(settings, name, 0.0))
        for name in ("monitoring_enabled", "volume", "reverb", "echo", "delay", "octave")
    }
    settings.monitoring_enabled = True
    settings.volume = body.microphone_volume
    settings.reverb = body.reverb
    settings.echo = body.echo
    settings.delay = body.delay
    settings.octave = body.octave
    try:
        audio_service.configure_monitoring(settings)
    finally:
        for name, (existed, value) in transient_values.items():
            if existed:
                setattr(settings, name, value)
            else:
                delattr(settings, name)
    return True


@router.get("/settings", response_model=schemas.AudioSettingsOut)
def get_recording_settings(db: Session = Depends(get_db)):
    return audio_service.get_settings(db)


@router.post("/start", response_model=schemas.RecordingStartOut)
@serialized
def start_recording(body: schemas.RecordingStartRequest, db: DatabaseSession):
    song = repositories.get_song(db, body.song_id)
    if song is None: raise HTTPException(status_code=404, detail="Песня не найдена")
    if pipeline_service.is_processing(song.id): raise HTTPException(status_code=409, detail="Нельзя начать запись во время обработки песни")
    if recording_service.has_live_capture():
        raise HTTPException(status_code=409, detail="A microphone recording is already active")
    settings = audio_service.get_settings(db)
    try:
        if body.room_mode:
            # The WebRTC room owns live self-monitoring. Opening a second
            # PortAudio output path here makes consumer USB/WASAPI devices
            # buffer twice and creates the delayed doubled voice users hear.
            audio_service.stop_monitoring()
            keep_native_monitor = False
        else:
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
            monitoring_enabled=(
                settings.monitoring_enabled and not keep_native_monitor and not body.room_mode
            ),
            playback_offset_sec=body.position_sec,
            playback_latency_sec=max(0, getattr(settings, "latency_ms", 50)) / 1000.0,
            blocksize=settings.buffer_size,
            music_gain=body.music_volume,
            effects={
                "reverb": body.reverb,
                "echo": body.echo,
                "delay": body.delay,
                "octave": body.octave,
            },
            noise_suppression=(
                0.35
                if getattr(settings, "noise_suppression", None) is None
                else settings.noise_suppression
            ),
            monitor_owner="room" if body.room_mode else "asio" if keep_native_monitor else "recording",
            monitor_mode=None if body.room_mode or keep_native_monitor else audio_service.recording_monitor_mode(input_device_id),
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


@router.post("/sync")
def sync_recording(session_id: str, position_sec: float):
    with http_error(KeyError, 404), http_error(RuntimeError, 409):
        recording_service.sync_recording(session_id, position_sec)
    return {"status": "synchronized"}


@router.post("/stop", response_model=schemas.RecordingOut)
def stop_recording(session_id: str, db: Session = Depends(get_db)):
    # Monitoring must be restored no matter how this ends — success, a mapped
    # error below, or an unmapped one (e.g. a writer/stream failure surfaces as
    # RuntimeError) — otherwise the user is left without mic monitoring until
    # they notice and start a new recording to trigger another restore.
    try:
        try:
            recording = recording_service.stop_recording(session_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except (OSError, RuntimeError) as exc:
            raise HTTPException(status_code=500, detail=f"Could not save recording: {exc}") from exc
    finally:
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


def _wav_file_response(recording: models.Recording) -> FileResponse:
    path = recording_service.resolve_recording_path(recording)
    if not path.is_file(): raise HTTPException(status_code=404, detail="Файл записи не найден")
    return FileResponse(path, media_type="audio/wav", filename=recording.filename)


@router.get("/{recording_id}/file")
def get_recording_file(recording: RecordingDependency):
    return _wav_file_response(recording)


@router.get("/{recording_id}/performance")
def get_performance_file(recording: RecordingDependency):
    for mixed_path in recording_service.performance_mix_paths(recording):
        if mixed_path.is_file():
            media_type = "audio/mpeg" if mixed_path.suffix == ".mp3" else "audio/wav"
            return FileResponse(mixed_path, media_type=media_type, filename=mixed_path.name)
    return _wav_file_response(recording)


@router.post("/{recording_id}/room-audio", response_model=schemas.RecordingOut)
async def attach_room_audio(
    recording: RecordingDependency,
    db: DatabaseSession,
    file: UploadFile = File(...),
    start_playback_sec: float = Form(default=0),
    latency_compensation_sec: float = Form(default=0),
):
    song = repositories.get_song(db, recording.song_id)
    if song is None: raise HTTPException(status_code=404, detail="Песня для записи не найдена")
    try:
        await file.seek(0)
        await run_in_threadpool(
            recording_service.attach_room_audio,
            recording,
            song,
            file.file,
            start_playback_sec,
            latency_compensation_sec,
        )
    except (OSError, RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=f"Could not add room voices: {exc}") from exc
    finally:
        await file.close()
    return recording


@router.delete("/{recording_id}", status_code=204)
def delete_recording(recording: RecordingDependency, db: DatabaseSession):
    recording_service.delete_recording(db, recording)
