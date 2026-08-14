"""
Точка входа FastAPI-приложения.

Это чистый backend/API — без UI. Локальный React/Electron/Qt-фронтенд
(добавится позже) будет стучаться сюда по http://127.0.0.1:8000.
"""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import config
from AI import service as ai_service
from app.routers import analysis, application, audio, cache, diagnostics, player, recording, songs
from app.services import audio_service, pipeline_service, recording_service, storage_migration
from database import init_db

_BENIGN_WINDOWS_DISCONNECTS = {64, 109, 232, 10053, 10054}


def _is_benign_client_disconnect(context: dict) -> bool:
    """Return true for normal Windows socket teardown noise.

    Chromium cancels keep-alive requests when a view reloads or Electron exits.
    ProactorEventLoop reports that expected disconnect as an unhandled callback
    error even though the request is already gone. It must not pollute the app
    console and persistent error log with a traceback.
    """
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
        if _is_benign_client_disconnect(context):
            return
        if previous_exception_handler is not None:
            previous_exception_handler(active_loop, context)
        else:
            active_loop.default_exception_handler(context)

    loop.set_exception_handler(handle_loop_exception)
    init_db()
    storage_migration.migrate_legacy_song_storage()
    for line in pipeline_service.format_runtime_plan(pipeline_service._configure_ai_runtime()):
        print(f"[backend] AI runtime: {line}", flush=True)
    try:
        yield
    finally:
        loop.set_exception_handler(previous_exception_handler)
        # Each cleanup must run even if the other one unexpectedly fails.
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
    return {"name": "A&D Voice Backend", "docs": "/docs"}
