from __future__ import annotations

import logging
import os
import threading
import time
from collections.abc import Callable
from typing import cast

from AI.runtime import RuntimePlan
from app.services import (
    background_task_supervisor,
    metadata_enrichment_service,
    pipeline_service,
    resource_deletion,
    song_package_service,
    storage_migration,
)

logger = logging.getLogger(__name__)
_lock = threading.RLock()
_started_at = 0.0
_state: dict[str, object] = {}
_DEFAULT_BUDGET_SECONDS = 30.0


def _budget_seconds() -> float:
    try:
        return max(1.0, float(os.getenv("SONGAPP_STARTUP_BUDGET_SECONDS", _DEFAULT_BUDGET_SECONDS)))
    except ValueError:
        return _DEFAULT_BUDGET_SECONDS


def _reset() -> None:
    global _started_at, _state
    _started_at = time.monotonic()
    _state = {
        "phase": "database",
        "progress": 5,
        "interactive": False,
        "ready": False,
        "error": None,
        "steps": {},
    }


def _set_state(**values: object) -> None:
    with _lock:
        _state.update(values)


def _run_step(name: str, progress: int, target: Callable[[], object]) -> object:
    started = time.monotonic()
    with _lock:
        _state["phase"] = name
        _state["progress"] = progress
        steps = _state["steps"]
        assert isinstance(steps, dict)
        steps[name] = {"state": "running", "duration_ms": None, "error": None}
    try:
        result = target()
    except BaseException as error:
        duration_ms = round((time.monotonic() - started) * 1000, 1)
        with _lock:
            steps = _state["steps"]
            assert isinstance(steps, dict)
            steps[name] = {
                "state": "error",
                "duration_ms": duration_ms,
                "error": f"{type(error).__name__}: {error}"[:1000],
            }
        raise
    duration_ms = round((time.monotonic() - started) * 1000, 1)
    with _lock:
        steps = _state["steps"]
        assert isinstance(steps, dict)
        steps[name] = {"state": "completed", "duration_ms": duration_ms, "error": None}
    logger.info("Startup step %s completed in %.1f ms", name, duration_ms)
    return result


def _queue_hardware_snapshot(runtime_plan) -> None:
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
                {"name": gpu.name, "vendor": gpu.vendor, "memory_bytes": gpu.memory_bytes}
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


def _run_startup() -> None:
    try:
        _run_step("file_cleanup_recovery", 15, resource_deletion.recover_deferred_cleanup)
        _run_step("storage_migration", 20, storage_migration.migrate_legacy_song_storage)
        _run_step("package_recovery", 40, song_package_service.recover_import_transactions)
        # The database and interrupted package transactions are now safe to
        # expose to the renderer. Metadata scanning and importing the heavy AI
        # runtime can continue in the background; song processing admission
        # remains closed until every startup step finishes below.
        _set_state(interactive=True)
        _run_step("metadata_scan", 55, metadata_enrichment_service.enqueue_missing)
        runtime_plan = cast(
            RuntimePlan,
            _run_step("hardware_detection", 75, pipeline_service._configure_ai_runtime),
        )
        for line in pipeline_service.format_runtime_plan(runtime_plan):
            print(f"[backend] AI runtime: {line}", flush=True)
        _run_step("diagnostics_snapshot", 90, lambda: _queue_hardware_snapshot(runtime_plan))
    except BaseException as error:
        pipeline_service.stop_accepting_jobs()
        _set_state(
            phase="failed",
            error=f"{type(error).__name__}: {error}"[:1000],
            ready=False,
        )
        raise
    pipeline_service.start_accepting_jobs()
    _set_state(phase="ready", progress=100, ready=True)


def start() -> bool:
    """Start the single ordered recovery/warmup job without blocking FastAPI."""
    with _lock:
        if _started_at and not _state.get("ready") and not _state.get("error"):
            return False
        _reset()
    pipeline_service.stop_accepting_jobs()
    started = background_task_supervisor.start_task("backend-startup", _run_startup)
    if not started:
        _set_state(phase="failed", error="Startup task is already running", ready=False)
    return started


def snapshot() -> dict[str, object]:
    with _lock:
        progress = _state.get("progress", 0)
        steps = _state.get("steps", {})
        result = {
            "phase": _state.get("phase", "not_started"),
            "progress": int(progress) if isinstance(progress, int | float | str) else 0,
            "interactive": bool(_state.get("interactive", False)),
            "ready": bool(_state.get("ready", False)),
            "error": _state.get("error"),
            "steps": dict(steps) if isinstance(steps, dict) else {},
        }
        elapsed = max(0.0, time.monotonic() - _started_at) if _started_at else 0.0
    budget = _budget_seconds()
    result["elapsed_ms"] = round(elapsed * 1000, 1)
    result["budget_ms"] = round(budget * 1000, 1)
    result["budget_exceeded"] = not result["ready"] and elapsed > budget
    if result["error"] or result["budget_exceeded"]:
        result["status"] = "degraded"
    elif result["ready"]:
        result["status"] = "ready"
    else:
        result["status"] = "starting"
    return result
