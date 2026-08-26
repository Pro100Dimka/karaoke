"""Диагностика backend'а и AI-пайплайна."""

from fastapi import APIRouter

import schemas
from app.services import diagnostics_service, model_install_service, pipeline_service

router = APIRouter(prefix="/diagnostics", tags=["diagnostics"])


@router.get("/health", response_model=schemas.HealthOut)
def health():
    return {"status": "ok", "version": diagnostics_service.BACKEND_VERSION}


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


@router.post("/client-log", status_code=204)
def client_log(entry: schemas.ClientLogIn):
    """Accept a frontend/Electron log line and fold it into application.log.

    Lets renderer and Electron-main errors land in the same single log file
    as the Python backend instead of only ever reaching devtools/the OS console.
    """
    diagnostics_service.record_client_log(entry)


@router.post("/shutdown")
def shutdown():
    """Best-effort graceful-shutdown hook, called by Electron before it kills
    this process: ask any active AI processing to cancel cooperatively so it
    has a bounded window to reach a clean state instead of being force-killed
    mid-write.
    """
    return {"cancelled": pipeline_service.cancel_all_active_processing()}
