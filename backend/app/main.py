"""
Точка входа FastAPI-приложения.

Это чистый backend/API — без UI. Локальный React/Electron/Qt-фронтенд
(добавится позже) будет стучаться сюда по http://127.0.0.1:8000.
"""

import asyncio
import hmac
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

import config
from AI import service as ai_service
from app.api.correlation import get_current, new_id, set_current
from app.routers import analysis, application, audio, cache, diagnostics, player, recording, songs
from app.services import (
    audio_service,
    cache_service,
    metadata_enrichment_service,
    pipeline_service,
    recording_service,
    song_package_service,
    storage_migration,
)
from database import init_db

logger = logging.getLogger(__name__)

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
    metadata_enrichment_service.enqueue_missing()
    runtime_plan = pipeline_service._configure_ai_runtime()
    runtime_lines = pipeline_service.format_runtime_plan(runtime_plan)
    for line in runtime_lines: print(f"[backend] AI runtime: {line}", flush=True)
    from app.services.app_settings_service import read_settings
    from app.services.remote_log_service import queue_hardware_snapshot

    settings = read_settings()
    hardware = runtime_plan.hardware
    queue_hardware_snapshot(
        {
            "cpu": hardware.cpu,
            "logical_cores": hardware.logical_cores,
            "ram_bytes": hardware.ram_bytes,
            "gpus": [
                {
                    "name": gpu.name,
                    "vendor": gpu.vendor,
                    "memory_bytes": gpu.memory_bytes,
                }
                for gpu in hardware.gpus
            ],
            "torch_available": hardware.torch_available,
            "cuda_available": hardware.cuda_available,
            "cuda_version": hardware.cuda_version,
            "selected_backends": {
                name: spec.key for name, spec in runtime_plan.selected.items()
            },
            "settings": {
                "compute_mode": settings.get("compute_mode"),
                "thread_count": settings.get("thread_count"),
            },
        }
    )
    try:
        yield
    finally:
        loop.set_exception_handler(previous_exception_handler)
        pipeline_service.cancel_all_active_processing()
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


@app.middleware("http")
async def attach_correlation_id(request: Request, call_next):
    """Tag this request so its error responses and log lines share one id.

    Registered after require_launch_token, so it wraps that middleware too
    and every response -- including a rejected-token 403 -- carries the id.
    """
    correlation_id = request.headers.get("X-Request-Id") or new_id()
    set_current(correlation_id)
    response = await call_next(request)
    response.headers["X-Request-Id"] = correlation_id
    return response


@app.exception_handler(StarletteHTTPException)
async def handle_http_exception(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    correlation_id = get_current() or "-"
    # A missing optional cover is a normal cache miss. Logging it as ERROR
    # caused harmless library thumbnail probes to be uploaded as diagnostics.
    log = (
        logger.info
        if exc.status_code == 404 and request.method == "GET" and request.url.path.endswith("/cover")
        else logger.error
    )
    log(
        "HTTP %s on %s %s: %s (request_id=%s)",
        exc.status_code, request.method, request.url.path, exc.detail, correlation_id,
    )
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "correlationId": correlation_id},
        headers=exc.headers,
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
