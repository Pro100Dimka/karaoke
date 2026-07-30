"""Управление песнями + запуск AI-обработки."""
import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from app.services import song_service, pipeline_service

router = APIRouter(prefix="/songs", tags=["songs"])


def _read_json(path: Path):
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


@router.post("", response_model=schemas.SongOut, status_code=201)
async def add_song(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    db: Session = Depends(get_db),
):
    file_bytes = await file.read()
    try:
        song = song_service.create_song(db, title or "", file.filename, file_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return song


@router.get("", response_model=list[schemas.SongOut])
def get_songs(db: Session = Depends(get_db)):
    return song_service.list_songs(db)


@router.get("/{song_id}", response_model=schemas.SongOut)
def get_song(song_id: str, db: Session = Depends(get_db)):
    song = song_service.get_song(db, song_id)
    if song is None:
        raise HTTPException(status_code=404, detail="Песня не найдена")
    return song


@router.patch("/{song_id}", response_model=schemas.SongOut)
def patch_song(song_id: str, patch: schemas.SongUpdate, db: Session = Depends(get_db)):
    song = song_service.get_song(db, song_id)
    if song is None:
        raise HTTPException(status_code=404, detail="Песня не найдена")
    return song_service.update_song(db, song, patch)


@router.delete("/{song_id}", status_code=204)
def remove_song(song_id: str, db: Session = Depends(get_db)):
    song = song_service.get_song(db, song_id)
    if song is None:
        raise HTTPException(status_code=404, detail="Песня не найдена")
    if pipeline_service.is_processing(song_id):
        raise HTTPException(status_code=409, detail="Песня сейчас обрабатывается, дождитесь завершения")
    song_service.delete_song(db, song)


@router.post("/{song_id}/process", response_model=schemas.ProcessingStatusOut, status_code=202)
def process_song(song_id: str, db: Session = Depends(get_db)):
    song = song_service.get_song(db, song_id)
    if song is None:
        raise HTTPException(status_code=404, detail="Песня не найдена")
    if pipeline_service.is_processing(song_id):
        raise HTTPException(status_code=409, detail="Обработка уже запущена")

    song.status = models.SongStatus.QUEUED
    song.error_message = None
    db.commit()

    pipeline_service.start_processing(song_id)
    db.refresh(song)
    return schemas.ProcessingStatusOut(
        song_id=song.id, status=song.status,
        progress_step=song.progress_step, progress_percent=song.progress_percent,
        error_message=song.error_message,
    )


@router.get("/{song_id}/status", response_model=schemas.ProcessingStatusOut)
def get_status(song_id: str, db: Session = Depends(get_db)):
    song = song_service.get_song(db, song_id)
    if song is None:
        raise HTTPException(status_code=404, detail="Песня не найдена")
    return schemas.ProcessingStatusOut(
        song_id=song.id, status=song.status,
        progress_step=song.progress_step, progress_percent=song.progress_percent,
        error_message=song.error_message,
    )


@router.get("/{song_id}/result", response_model=schemas.SongResultOut)
def get_result(song_id: str, db: Session = Depends(get_db)):
    song = song_service.get_song(db, song_id)
    if song is None:
        raise HTTPException(status_code=404, detail="Песня не найдена")
    if song.status != models.SongStatus.DONE or not song.output_dir:
        raise HTTPException(status_code=409, detail="Песня ещё не обработана")

    out_dir = Path(song.output_dir)
    return schemas.SongResultOut(
        song=song,
        music=_read_json(out_dir / "music.json"),
        reference_notes=_read_json(out_dir / "reference.json"),
        lyrics_sync=_read_json(out_dir / "lyrics.json"),
        song_map=_read_json(out_dir / "songInfo.json"),
        difficulty=_read_json(out_dir / "difficulty.json"),
        structure=_read_json(out_dir / "structure.json"),
        breaths=_read_json(out_dir / "breaths.json"),
        manifest=None,
    )
