"""Cache and storage-maintenance endpoints."""

from fastapi import APIRouter, HTTPException

import schemas
from app.services import cache_service

router = APIRouter(prefix="/cache", tags=["cache"])


def _clear_temp_response() -> dict[str, int]: return {'freed_bytes': cache_service.clear_temp_files()}


@router.get("/size", response_model=schemas.CacheSizeOut)
def get_cache_size():
    return cache_service.cache_size()


@router.get("/free-space", response_model=schemas.FreeSpaceOut)
def get_free_space():
    return cache_service.free_space()


@router.post("/clear")
def clear_cache():
    return _clear_temp_response()


@router.delete("/temp")
def delete_temp():
    return _clear_temp_response()


@router.post("/optimize/{song_id}", response_model=schemas.OptimizeResultOut)
def optimize_song(song_id: str):
    result = cache_service.optimize_song_files(song_id)
    if not result["actions"] and result["freed_bytes"] == 0:
        raise HTTPException(
            status_code=404, detail="Песня не найдена, не обработана или уже оптимизирована"
        )
    return result
