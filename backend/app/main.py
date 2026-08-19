"""
Точка входа FastAPI-приложения.

Это чистый backend/API — без UI. Локальный React/Electron/Qt-фронтенд
(добавится позже) будет стучаться сюда по http://127.0.0.1:8000.
"""

import asyncio
import hmac
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import config
from AI import service as ai_service
from app.routers import analysis, application, audio, cache, diagnostics, player, recording, songs
from app.services import (
    audio_service,
    cache_service,
    pipeline_service,
    recording_service,
    song_package_service,
    storage_migration,
)
from database import init_db

_BENIGN_WINDOWS_DISCONNECTS = {64, 109, 232, 10053, 10054}


def _is_benign_client_disconnect(context: dict) -> bool:
    error = context.get("exception")
    return (
        isinstance(error, (ConnectionResetError, BrokenPipeError))
        and getattr(error, "winerror", None) in _BENIGN_WINDOWS_DISCONNECTS
    )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    loop = asyncio.get_running_loop()
    previous_exception_handler = loop.get_exception_handler()

    def handle_loop_exception(active_loop, context):
        if _is_benign_client_disconnect(context): return
        if previous_exception_handler is not None:
            previous_exception_handler(active_loop, context)
        else:
            active_loop.default_exception_handler(context)

    loop.set_exception_handler(handle_loop_exception)
    init_db()
    storage_migration.migrate_legacy_song_storage()
    song_package_service.recover_import_transactions()
    cache_service.recover_optimization_transactions()
    for line in pipeline_service.format_runtime_plan(pipeline_service._configure_ai_runtime()): print(f"[backend] AI runtime: {line}", flush=True)
    try:
        yield
    finally:
        loop.set_exception_handler(previous_exception_handler)
        try:
            recording_service.close_all_sessions()
        finally:
            try:
                audio_service.stop_monitoring()
            finally:
                ai_service.reset_ai_service()


app = FastAPI(
    title="A&D Voice Backend",
    description="Локальный backend поверх AI-пайплайна: управление песнями, плеер, запись, анализ голоса.",
    version="0.3.5",
    lifespan=lifespan,
)

# CORS is explicit and configurable. Production Electron builds should pass
# only their actual origin through SONGAPP_CORS_ORIGINS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(config.CORS_ORIGINS),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Accept", "Authorization", "Content-Type", "X-ADVoice-Token"],
)

_API_TOKEN = os.environ.get("SONGAPP_API_TOKEN", "")


@app.middleware("http")
async def require_launch_token(request: Request, call_next):
    """Authenticate the Electron-to-loopback capability when a launch token is configured."""
    if _API_TOKEN and request.method != "OPTIONS":
        supplied = request.headers.get("X-ADVoice-Token", "")
        if not supplied or not hmac.compare_digest(supplied, _API_TOKEN): return JSONResponse({"detail": "Invalid local API token"}, status_code=403)
    return await call_next(request)

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
    return {"name": "A&D Voice Backend", "docs": "/docs"}
