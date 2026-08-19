"""Управление песнями + запуск AI-обработки."""

import tempfile
import zipfile
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
)
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

import config
import models
import schemas
from app.api.dependencies import SongDependency
from app.api.errors import http_error
from app.services import (
    ai_bridge,
    pipeline_service,
    recording_service,
    song_artifacts,
    song_editor_service,
    song_package_service,
    song_service,
)
from app.services.db_utils import commit, commit_refresh
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
    progress_detail, live_percent, eta_seconds = telemetry.get('progress_detail'), telemetry.get('progress_percent'), telemetry.get('eta_seconds')
    return schemas.ProcessingStatusOut(
        song_id=song.id,
        status=song.status,
        progress_step=song.progress_step,
        progress_percent=(
            float(live_percent) if isinstance(live_percent, int | float) else song.progress_percent
        ),
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
    previous = {field: getattr(song, field) for field in queued_values}

    def restore_previous_state() -> None:
        for field, value in previous.items(): setattr(song, field, value)
        commit(db)

    for field, value in queued_values.items(): setattr(song, field, value)
    try:
        commit(db)
    except Exception:
        for field, value in previous.items(): setattr(song, field, value)
        raise

    try:
        started = start_job(song.id)
    except Exception:
        restore_previous_state()
        raise
    if started: return
    restore_previous_state()
    raise HTTPException(status_code=409, detail="Обработка уже запущена")


def _touch_song(db: Session, song: models.Song, *, refresh: bool) -> None:
    song.updated_at = datetime.now(UTC)
    db.add(song)
    if refresh:
        commit_refresh(db, song)
    else:
        commit(db)


def _song_error_status(detail: str) -> int: return 404 if detail == 'Song not found' else 409


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


@router.get("/{song_id}/revision")
def get_song_revision(song_id: str, db: Session = Depends(get_db)):
    try:
        revision = song_package_service.content_revision_for_song(db, song_id)
    except (OSError, ValueError) as exc:
        detail = str(exc)
        raise HTTPException(
            status_code=_song_error_status(detail), detail=f"Could not fingerprint song: {detail}"
        ) from exc
    return {"song_id": song_id, "revision": revision}


@router.get("/{song_id}/package")
def export_song_package(
    song_id: str, background_tasks: BackgroundTasks, expected_revision: str | None = None,
    db: Session = Depends(get_db),
):
    try:
        package_path, slug = song_package_service.build_package_for_song(
            db, song_id, expected_revision=expected_revision,
        )
    except (OSError, ValueError) as exc:
        detail = str(exc)
        raise HTTPException(
            status_code=_song_error_status(detail), detail=f"Could not package song: {detail}"
        ) from exc
    background_tasks.add_task(package_path.unlink, missing_ok=True)
    return FileResponse(
        package_path,
        media_type="application/zip",
        filename=f"{slug}.karaoke.zip",
        background=background_tasks,
    )


@router.post("/package/import", response_model=schemas.SongOut, status_code=201)
async def import_song_package(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    expected_revision: str | None = None,
):
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        prefix="karaoke-import-",
        suffix=".zip",
        dir=config.CACHE_DIR,
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
        return song_package_service.import_package(db, temporary_path, expected_revision=expected_revision)
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
    with http_error(ValueError, 422): return song_service.update_song(db, song, patch)


@router.delete("/{song_id}", status_code=204)
def remove_song(song: SongDependency, db: Session = Depends(get_db)):
    if recording_service.has_active_recording(song.id): raise HTTPException(status_code=409, detail="Нельзя удалить песню во время записи")
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
    if recording_service.has_active_recording(song.id): raise HTTPException(status_code=409, detail="Нельзя обрабатывать песню во время записи")
    if pipeline_service.is_processing(song.id): raise HTTPException(status_code=409, detail="Обработка уже запущена")

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
    if recording_service.has_active_recording(song.id): raise HTTPException(status_code=409, detail="Нельзя переобрабатывать песню во время записи")
    if not song.output_dir or song.status != models.SongStatus.DONE: raise HTTPException(status_code=409, detail="Сначала завершите полную обработку песни")
    if pipeline_service.is_processing(song.id): raise HTTPException(status_code=409, detail="Обработка уже запущена")

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
    if not pipeline_service.cancel_processing(song.id): raise HTTPException(status_code=409, detail="Song is not being processed")
    db.refresh(song)
    return _processing_status(song)


@router.get("/{song_id}/log")
def get_processing_log(song: SongDependency):
    log_path = song_service.resolve_output_dir(song) / config.LOGS_DIRNAME / "pipeline.log"
    return {'lines': []} if not log_path.exists() else {'lines': read_text_tail(log_path)}


@router.get("/{song_id}/cover")
def get_song_cover(song: SongDependency):
    output_dir, covers = song_service.resolve_output_dir(song), (('cover.jpg', 'image/jpeg'), ('cover.png', 'image/png'), ('cover.webp', 'image/webp'))
    for filename, media_type in covers:
        path = output_dir / filename
        if path.is_file(): return FileResponse(path, media_type=media_type)

    source = song_service.resolve_source_path(song)
    recovered = song_service.extract_embedded_cover(source, output_dir) if source.is_file() else None
    if recovered is not None:
        media_type = {".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}[recovered.suffix.lower()]
        return FileResponse(recovered, media_type=media_type)
    raise HTTPException(status_code=404, detail="Song cover not found")


@router.get("/{song_id}/audio/{track}")
def get_audio_track(track: str, song: SongDependency):
    if track not in {"instrumental", "vocals", "song", "diagnostic"}: raise HTTPException(status_code=404, detail="Unknown audio track")
    output_dir = song_service.resolve_output_dir(song)
    if (candidate := song_artifacts.resolve_audio_artifact(output_dir, track)) is not None:
        media_type = {".flac": "audio/flac", ".mp3": "audio/mpeg", ".wav": "audio/wav"}.get(
            candidate.suffix.lower(), "application/octet-stream"
        )
        return FileResponse(
            candidate,
            media_type=media_type,
            filename=candidate.name,
            content_disposition_type="inline",
        )
    raise HTTPException(status_code=404, detail="Audio track is not available")


@router.get("/{song_id}/editor", response_model=schemas.SongEditorOut)
def get_song_editor(song: SongDependency):
    if song.status != models.SongStatus.DONE: raise HTTPException(status_code=409, detail="Песня ещё не обработана")
    with http_error(ValueError, 409):
        song_map, backup_exists = song_editor_service.load_editor(
            song_service.resolve_output_dir(song)
        )
    return schemas.SongEditorOut(song_map=song_map, ai_backup_exists=backup_exists)


@router.put("/{song_id}/editor", response_model=schemas.SongEditorOut)
def save_song_editor(
    payload: schemas.SongEditorUpdate, song: SongDependency, db: Session = Depends(get_db)
):
    if song.status != models.SongStatus.DONE: raise HTTPException(status_code=409, detail="Песня ещё не обработана")
    with http_error(ValueError, 400), song_service.song_content_lock(song.id), song_service.library_write_lock():
        song_map = song_editor_service.save_editor(
            song_service.resolve_output_dir(song), payload.notes
        )
        song_package_service.invalidate_content_revision(song)
    _touch_song(db, song, refresh=True)
    return schemas.SongEditorOut(song_map=song_map, ai_backup_exists=True)


@router.post("/{song_id}/editor/reset", response_model=schemas.SongEditorOut)
def reset_song_editor(song: SongDependency, db: Session = Depends(get_db)):
    if song.status != models.SongStatus.DONE: raise HTTPException(status_code=409, detail="Песня ещё не обработана")
    with http_error(ValueError, 409), song_service.song_content_lock(song.id), song_service.library_write_lock():
        song_map = song_editor_service.reset_editor(song_service.resolve_output_dir(song))
        song_package_service.invalidate_content_revision(song)
    _touch_song(db, song, refresh=False)
    return schemas.SongEditorOut(song_map=song_map, ai_backup_exists=True)


@router.get("/{song_id}/result", response_model=schemas.SongResultOut)
def get_result(song: SongDependency, response: Response):
    if song.status != models.SongStatus.DONE or not song.output_dir: raise HTTPException(status_code=409, detail="Песня ещё не обработана")

    out_dir = song_service.resolve_output_dir(song)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    return schemas.SongResultOut(
        song=schemas.SongOut.model_validate(song),
        music=read_json(out_dir / "music.json"),
        reference_notes=ai_bridge.get_reference_notes(out_dir),
        game_notes=ai_bridge.get_game_notes(out_dir),
        syllables=ai_bridge.get_syllables(out_dir),
        lyrics_sync=ai_bridge.get_karaoke_lyrics(out_dir),
        karaoke_timeline=ai_bridge.get_karaoke_timeline(out_dir),
        song_map=read_json(out_dir / "songMap.json"),
        difficulty=read_json(out_dir / "difficulty.json"),
        structure=read_json(out_dir / "structure.json"),
        breaths=read_json(out_dir / "breaths.json"),
        manifest=read_json(out_dir / "manifest.json"),
    )


@router.put("/{song_id}/lyrics")
def update_lyrics(body: schemas.LyricsUpdate, song: SongDependency):
    if song.status != models.SongStatus.DONE or not song.output_dir: raise HTTPException(status_code=409, detail="Song has not been processed yet")

    out_dir = song_service.resolve_output_dir(song)
    lyrics_path = out_dir / "lyrics.json"
    try:
        reconcile_lyric_words = ai_bridge.reconcile_lyric_words
        lyrics = reconcile_lyric_words([line.model_dump() for line in body.lyrics])
        write_json(lyrics_path, lyrics)
        trusted_text = "\n".join(str(line.get("text") or "").strip() for line in lyrics).strip()
        if trusted_text:
            (out_dir / config.TRUSTED_LYRICS_FILENAME).write_text(
                trusted_text + "\n", encoding="utf-8"
            )
    except (OSError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Could not save lyrics: {exc}") from exc
    return {"status": "saved"}
