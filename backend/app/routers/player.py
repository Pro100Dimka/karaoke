"""Караоке-плеер: синхронизация, таймлайн, управление воспроизведением."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import schemas
from database import get_db
from app.services import song_service, player_service

router = APIRouter(prefix="/player", tags=["player"])


def _get_song_or_404(song_id: str, db: Session):
    song = song_service.get_song(db, song_id)
    if song is None:
        raise HTTPException(status_code=404, detail="Песня не найдена")
    return song


@router.get("/{song_id}/sync")
def get_sync(song_id: str, db: Session = Depends(get_db)):
    song = _get_song_or_404(song_id, db)
    return player_service.get_sync_data(song)


@router.get("/{song_id}/timeline")
def get_timeline(song_id: str, db: Session = Depends(get_db)):
    song = _get_song_or_404(song_id, db)
    return player_service.get_timeline(song)


@router.get("/{song_id}/position", response_model=schemas.PlaybackStateOut)
def get_position(song_id: str, db: Session = Depends(get_db)):
    _get_song_or_404(song_id, db)
    return player_service.get_state(db, song_id)


@router.post("/{song_id}/seek", response_model=schemas.PlaybackStateOut)
def seek(song_id: str, body: schemas.SeekRequest, db: Session = Depends(get_db)):
    _get_song_or_404(song_id, db)
    return player_service.seek(db, song_id, body.position_sec)


@router.post("/{song_id}/pause", response_model=schemas.PlaybackStateOut)
def pause(song_id: str, db: Session = Depends(get_db)):
    _get_song_or_404(song_id, db)
    return player_service.set_playing(db, song_id, False)


@router.post("/{song_id}/resume", response_model=schemas.PlaybackStateOut)
def resume(song_id: str, db: Session = Depends(get_db)):
    _get_song_or_404(song_id, db)
    return player_service.set_playing(db, song_id, True)


@router.post("/{song_id}/stop", response_model=schemas.PlaybackStateOut)
def stop(song_id: str, db: Session = Depends(get_db)):
    _get_song_or_404(song_id, db)
    return player_service.stop(db, song_id)
