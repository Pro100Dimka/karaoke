"""Karaoke synchronization, timeline and playback-state endpoints."""

from fastapi import APIRouter

import schemas
from app.api.dependencies import DatabaseSession, SongDependency
from app.services import player_service

router = APIRouter(prefix="/player", tags=["player"])


@router.get("/{song_id}/sync")
def get_sync(song: SongDependency): return player_service.get_sync_data(song)


@router.get("/{song_id}/timeline")
def get_timeline(song: SongDependency): return player_service.get_timeline(song)


@router.get("/{song_id}/position", response_model=schemas.PlaybackStateOut)
def get_position(song: SongDependency, db: DatabaseSession): return player_service.get_state(db, song.id)


@router.post("/{song_id}/seek", response_model=schemas.PlaybackStateOut)
def seek(song: SongDependency, body: schemas.SeekRequest, db: DatabaseSession): return player_service.seek(db, song.id, body.position_sec)


@router.post("/{song_id}/pause", response_model=schemas.PlaybackStateOut)
def pause(song: SongDependency, db: DatabaseSession): return player_service.set_playing(db, song.id, False)


@router.post("/{song_id}/resume", response_model=schemas.PlaybackStateOut)
def resume(song: SongDependency, db: DatabaseSession): return player_service.set_playing(db, song.id, True)


@router.post("/{song_id}/stop", response_model=schemas.PlaybackStateOut)
def stop(song: SongDependency, db: DatabaseSession): return player_service.stop(db, song.id)
