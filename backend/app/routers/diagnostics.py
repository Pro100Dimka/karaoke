"""Диагностика backend'а и AI-пайплайна."""

from fastapi import APIRouter

import schemas
from app.services import diagnostics_service

router = APIRouter(prefix="/diagnostics", tags=["diagnostics"])


@router.get("/health", response_model=schemas.HealthOut)
def health():
    return {"status": "ok", "version": diagnostics_service.BACKEND_VERSION}


@router.get("/pipeline", response_model=schemas.PipelineHealthOut)
def pipeline_health():
    return diagnostics_service.pipeline_health()


@router.get("/models", response_model=schemas.PipelineHealthOut)
def models_health():
    # Тот же набор проверок, что и /pipeline — оставлено отдельным
    # эндпоинтом по ТЗ ("проверить доступность моделей AI" отдельно от
    # общего состояния пайплайна), при необходимости можно детализировать.
    return diagnostics_service.pipeline_health()


@router.get("/versions", response_model=schemas.VersionsOut)
def versions():
    return diagnostics_service.versions()


@router.get("/errors", response_model=schemas.SystemErrorsOut)
def errors():
    return {"errors": diagnostics_service.recent_errors()}
