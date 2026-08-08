"""
Точка входа FastAPI-приложения.

Это чистый backend/API — без UI. Локальный React/Electron/Qt-фронтенд
(добавится позже) будет стучаться сюда по http://127.0.0.1:8000.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import config
from app.routers import analysis, application, audio, cache, diagnostics, player, recording, songs
from app.services import audio_service, recording_service, storage_migration
from database import init_db


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    storage_migration.migrate_legacy_song_storage()
    try:
        yield
    finally:
        # Each cleanup must run even if the other one unexpectedly fails.
        try:
            recording_service.close_all_sessions()
        finally:
            audio_service.stop_monitoring()


app = FastAPI(
    title="Karaoke AI Backend",
    description="Локальный backend поверх AI-пайплайна: управление песнями, плеер, запись, анализ голоса.",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS is explicit and configurable. Production Electron builds should pass
# only their actual origin through SONGAPP_CORS_ORIGINS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(config.CORS_ORIGINS),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Accept", "Authorization", "Content-Type"],
)

app.include_router(songs.router)
app.include_router(player.router)
app.include_router(recording.router)
app.include_router(analysis.router)
app.include_router(cache.router)
app.include_router(diagnostics.router)
app.include_router(audio.router)
app.include_router(application.router)


@app.get("/")
def root():
    return {"name": "Karaoke AI Backend", "docs": "/docs"}
