"""Управление песнями + запуск AI-обработки."""

import tempfile
import zipfile
from collections.abc import Callable
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

import config
import models
import schemas
from app.api.dependencies import SongDependency
from app.services import ai_bridge, pipeline_service, song_package_service, song_service
from app.utils.files import read_text_tail
from app.utils.json_files import read_json, write_json
from app.utils.uploads import save_upload_limited
from database import get_db

router = APIRouter(prefix="/songs", tags=["songs"])


def _processing_status(
    song: models.Song,
    *,
    telemetry: dict[str, object] | None = None,
) -> schemas.ProcessingStatusOut:
    telemetry = telemetry or {}
    progress_detail = telemetry.get("progress_detail")
    eta_seconds = telemetry.get("eta_seconds")
    return schemas.ProcessingStatusOut(
        song_id=song.id,
        status=song.status,
        progress_step=song.progress_step,
        progress_percent=song.progress_percent,
        progress_detail=progress_detail if isinstance(progress_detail, str) else None,
        eta_seconds=eta_seconds if isinstance(eta_seconds, int) else None,
        error_message=song.error_message,
    )


def _queue_song_job(
    db: Session,
    song: models.Song,
    start_job: Callable[[str], bool],
    **queued_values: object,
) -> None:
    """Persist queued state and compensate if the worker cannot be started."""
    previous = {field: getattr(song, field) for field in queued_values}

    def restore_previous_state() -> None:
        for field, value in previous.items():
            setattr(song, field, value)
        try:
            db.commit()
        except Exception:
            db.rollback()
            raise

    for field, value in queued_values.items():
        setattr(song, field, value)
    try:
        db.commit()
    except Exception:
        db.rollback()
        for field, value in previous.items():
            setattr(song, field, value)
        raise

    try:
        started = start_job(song.id)
    except Exception:
        restore_previous_state()
        raise
    if started:
        return
    restore_previous_state()
    raise HTTPException(status_code=409, detail="Обработка уже запущена")


@router.post("", response_model=schemas.SongOut, status_code=201)
async def add_song(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    db: Session = Depends(get_db),
):
    config.UPLOAD_TEMP_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        prefix=".song-upload-",
        suffix=".tmp",
        dir=config.UPLOAD_TEMP_DIR,
        delete=False,
    ) as temporary:
        temporary_path = Path(temporary.name)
    try:
        await save_upload_limited(
            file,
            temporary_path,
            limit=config.MAX_AUDIO_UPLOAD_BYTES,
            chunk_size=config.UPLOAD_CHUNK_SIZE,
            too_large_message="Audio file is too large",
        )
        return song_service.create_song_from_path(
            db,
            title or "",
            file.filename or "song",
            temporary_path,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        temporary_path.unlink(missing_ok=True)


@router.get("", response_model=list[schemas.SongOut])
def get_songs(db: Session = Depends(get_db)):
    return song_service.list_songs(db)


@router.get("/{song_id}", response_model=schemas.SongOut)
def get_song(song: SongDependency):
    return song


@router.get("/{song_id}/package")
def export_song_package(song: SongDependency, background_tasks: BackgroundTasks):
    if song.status != models.SongStatus.DONE:
        raise HTTPException(status_code=409, detail="Song processing is not complete")
    try:
        package_path = song_package_service.build_package(song)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=409, detail=f"Could not package song: {exc}") from exc
    background_tasks.add_task(package_path.unlink, missing_ok=True)
    return FileResponse(
        package_path,
        media_type="application/zip",
        filename=f"{song.slug}.karaoke.zip",
        background=background_tasks,
    )


@router.post("/package/import", response_model=schemas.SongOut, status_code=201)
async def import_song_package(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        prefix="karaoke-import-",
        suffix=".zip",
        dir=config.DATA_DIR,
        delete=False,
    ) as temporary:
        temporary_path = Path(temporary.name)
    try:
        await save_upload_limited(
            file,
            temporary_path,
            limit=song_package_service.MAX_PACKAGE_BYTES,
            chunk_size=1024 * 1024,
            too_large_message="Song package is too large",
        )
        return song_package_service.import_package(db, temporary_path)
    except HTTPException:
        raise
    except (OSError, ValueError, zipfile.BadZipFile) as exc:
        raise HTTPException(
            status_code=400, detail=f"Could not import song package: {exc}"
        ) from exc
    finally:
        temporary_path.unlink(missing_ok=True)


@router.patch("/{song_id}", response_model=schemas.SongOut)
def patch_song(song: SongDependency, patch: schemas.SongUpdate, db: Session = Depends(get_db)):
    try:
        return song_service.update_song(db, song, patch)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/{song_id}", status_code=204)
def remove_song(song: SongDependency, db: Session = Depends(get_db)):
    if pipeline_service.is_processing(song.id):
        raise HTTPException(
            status_code=409, detail="Песня сейчас обрабатывается, дождитесь завершения"
        )
    try:
        song_service.delete_song(db, song)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=409, detail=f"Could not delete song files: {exc}") from exc


@router.post("/{song_id}/process", response_model=schemas.ProcessingStatusOut, status_code=202)
def process_song(song: SongDependency, db: Session = Depends(get_db)):
    if pipeline_service.is_processing(song.id):
        raise HTTPException(status_code=409, detail="Обработка уже запущена")

    _queue_song_job(
        db,
        song,
        pipeline_service.start_processing,
        status=models.SongStatus.QUEUED,
        error_message=None,
    )
    db.refresh(song)
    return _processing_status(song)


@router.post("/{song_id}/reprocess", response_model=schemas.ProcessingStatusOut, status_code=202)
def reprocess_melody(song: SongDependency, db: Session = Depends(get_db)):
    """Clear prior generated files and rebuild the song with the current MIDI algorithm."""
    if not song.output_dir or song.status != models.SongStatus.DONE:
        raise HTTPException(status_code=409, detail="Сначала завершите полную обработку песни")
    if pipeline_service.is_processing(song.id):
        raise HTTPException(status_code=409, detail="Обработка уже запущена")

    _queue_song_job(
        db,
        song,
        pipeline_service.start_reprocessing,
        status=models.SongStatus.QUEUED,
        error_message=None,
        progress_percent=0.0,
        progress_step="0/13",
    )
    db.refresh(song)
    return _processing_status(song)


@router.get("/{song_id}/status", response_model=schemas.ProcessingStatusOut)
def get_status(song: SongDependency):
    telemetry = pipeline_service.get_processing_telemetry(song.id)
    return _processing_status(song, telemetry=telemetry)


@router.post("/{song_id}/cancel", response_model=schemas.ProcessingStatusOut)
def cancel_processing(song: SongDependency, db: Session = Depends(get_db)):
    if not pipeline_service.cancel_processing(song.id):
        raise HTTPException(status_code=409, detail="Song is not being processed")
    db.refresh(song)
    return _processing_status(song)


@router.get("/{song_id}/log")
def get_processing_log(song: SongDependency):
    log_path = song_service.resolve_output_dir(song) / config.LOGS_DIRNAME / "pipeline.log"
    if not log_path.exists():
        return {"lines": []}
    return {"lines": read_text_tail(log_path)}


@router.get("/{song_id}/audio/{track}")
def get_audio_track(track: str, song: SongDependency):
    if track not in {"instrumental", "vocals", "song"}:
        raise HTTPException(status_code=404, detail="Unknown audio track")
    output_dir = song_service.resolve_output_dir(song)
    search_dirs = [output_dir]
    if track in {"instrumental", "vocals"}:
        # AI Core v2 stores production stems in separated/. Keep the root
        # directory as a legacy fallback for songs created by older versions.
        search_dirs.insert(0, output_dir / "separated")
    for directory in search_dirs:
        for extension, media_type in ((".mp3", "audio/mpeg"), (".wav", "audio/wav")):
            candidate = directory / f"{track}{extension}"
            if candidate.is_file():
                return FileResponse(
                    candidate,
                    media_type=media_type,
                    filename=candidate.name,
                    content_disposition_type="inline",
                )
    raise HTTPException(status_code=404, detail="Audio track is not available")


@router.get("/{song_id}/result", response_model=schemas.SongResultOut)
def get_result(song: SongDependency):
    if song.status != models.SongStatus.DONE or not song.output_dir:
        raise HTTPException(status_code=409, detail="Песня ещё не обработана")

    out_dir = song_service.resolve_output_dir(song)
    return schemas.SongResultOut(
        song=schemas.SongOut.model_validate(song),
        music=read_json(out_dir / "music.json"),
        reference_notes=ai_bridge.get_reference_notes(out_dir),
        lyrics_sync=read_json(out_dir / "lyrics.json"),
        song_map=read_json(out_dir / "songInfo.json"),
        difficulty=read_json(out_dir / "difficulty.json"),
        structure=read_json(out_dir / "structure.json"),
        breaths=read_json(out_dir / "breaths.json"),
        manifest=read_json(out_dir / "manifest.json"),
    )


@router.put("/{song_id}/lyrics")
def update_lyrics(body: schemas.LyricsUpdate, song: SongDependency):
    if song.status != models.SongStatus.DONE or not song.output_dir:
        raise HTTPException(status_code=409, detail="Song has not been processed yet")

    lyrics_path = song_service.resolve_output_dir(song) / "lyrics.json"
    try:
        reconcile_lyric_words = ai_bridge.get_reconcile_lyric_words()
        lyrics = reconcile_lyric_words([line.model_dump() for line in body.lyrics])
        write_json(lyrics_path, lyrics)
    except (OSError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Could not save lyrics: {exc}") from exc
    return {"status": "saved"}
