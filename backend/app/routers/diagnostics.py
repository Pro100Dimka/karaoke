"""Диагностика backend'а и AI-пайплайна."""

from fastapi import APIRouter

import database
import schemas
from app.services import (
    background_task_supervisor,
    diagnostics_service,
    model_install_service,
    pipeline_service,
    startup_service,
    storage_budget_service,
)

router = APIRouter(prefix="/diagnostics", tags=["diagnostics"])


@router.get("/health", response_model=schemas.HealthOut)
def health():
    startup = startup_service.snapshot()
    return {
        "status": "ok" if startup["ready"] else startup["status"],
        "version": diagnostics_service.BACKEND_VERSION,
        "startup": startup,
    }


@router.get("/models", response_model=schemas.PipelineHealthOut)
@router.get("/pipeline", response_model=schemas.PipelineHealthOut)
def pipeline_health():
    return diagnostics_service.pipeline_health()


models_health = pipeline_health


@router.get("/ai-models", response_model=schemas.AIModelsStatusOut)
def ai_models_status():
    return model_install_service.status()


@router.post("/ai-models/download", response_model=schemas.AIModelsStatusOut, status_code=202)
def download_ai_models():
    return model_install_service.start_download()


@router.get("/versions", response_model=schemas.VersionsOut)
def versions():
    return diagnostics_service.versions()


@router.get("/errors", response_model=schemas.SystemErrorsOut)
def errors():
    return {"errors": diagnostics_service.recent_errors()}


@router.get("/background-tasks")
def background_tasks():
    return {
        **background_task_supervisor.snapshot(),
        "storage": storage_budget_service.snapshot(),
    }


@router.get("/database-schema")
def database_schema():
    return database.schema_status()


@router.post("/client-log", status_code=204)
def client_log(entry: schemas.ClientLogIn):
    """Accept a frontend/Electron log line and fold it into application.log.

    Lets renderer and Electron-main errors land in the same single log file
    as the Python backend instead of only ever reaching devtools/the OS console.
    """
    diagnostics_service.record_client_log(entry)


@router.post("/shutdown")
def shutdown():
    """Stop admission and wait a bounded time for every backend worker."""
    background_task_supervisor.stop_accepting()
    return {
        "pipeline": pipeline_service.shutdown_active_processing(timeout=10.0),
        "background": background_task_supervisor.shutdown(timeout=10.0),
    }
