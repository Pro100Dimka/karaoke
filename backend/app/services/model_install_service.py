
from __future__ import annotations

import logging
import threading
from pathlib import Path

import config
from AI.errors import ProcessingCancelledError
from AI.install_models import ProgressReporter, install_one, is_valid
from AI.model_registry import MODELS

logger = logging.getLogger(__name__)

_lock = threading.RLock()
_condition = threading.Condition(_lock)
_state: dict[str, str | None] = {
    "state": "idle",
    "current_model": None,
    "error": None,
}


def _progress_values() -> dict[str, int]:
    path = config.APP_LOG_DIR / "model-recovery-progress.txt"
    try:
        pairs = dict(
            line.split("=", 1)
            for line in path.read_text(encoding="utf-8").splitlines()
            if "=" in line
        )
    except OSError: return {}
    result = {}
    for name in ("downloaded_bytes", "total_bytes", "remaining_seconds"):
        try: result[name] = int(pairs[name])
        except (KeyError, ValueError): continue
    return result


def _model_states(models_root: Path) -> list[dict[str, object]]: return [{'key': model.key, 'name': model.name, 'ready': is_valid(models_root, model)} for model in MODELS]


def status() -> dict[str, object]:
    models_root = config.MODELS_DIR.resolve(); models = _model_states(models_root); ready_count = sum(bool(model["ready"]) for model in models)
    with _lock: runtime = dict(_state)

    state = str(runtime["state"])
    if ready_count == len(models):
        state = "ready"
    elif state not in {"downloading", "error"}: state = "missing"

    return {
        "state": state,
        "ready": ready_count == len(models),
        "ready_count": ready_count,
        "total": len(models),
        "current_model": None if state == "ready" else runtime["current_model"],
        "error": None if state == "ready" else runtime["error"],
        "models_dir": str(models_root),
        "models": models,
        **_progress_values(),
    }


def _set_state(**changes: str | None) -> None:
    with _lock: _state.update(changes)


def _install_missing_models(
    models_root: Path,
    cache_dir: Path,
    reporter: ProgressReporter,
    *,
    verification_failure_message: str,
    log_repairs: bool,
) -> None:
    for model in MODELS:
        if is_valid(models_root, model):
            reporter.model_finished(model.name); continue
        if log_repairs:
            logger.warning(
                "Repairing incomplete AI model before processing: %s", model.name)
        _set_state(current_model=model.name); reporter.model_started(model.name); install_one(models_root, cache_dir, model, retries=3); reporter.model_finished(model.name)

    if not all(is_valid(models_root, model) for model in MODELS): raise RuntimeError(verification_failure_message)
    config.configure_ai_resource_environment(force=True); from AI.service import reset_ai_service

    reset_ai_service()


def _recover_models(models_root: Path, cache_dir: Path, reporter: ProgressReporter, *, verification_message: str, log_repairs: bool) -> None: models_root.mkdir(parents=True, exist_ok=True); cache_dir.mkdir(parents=True, exist_ok=True); _install_missing_models(models_root, cache_dir, reporter, verification_failure_message=verification_message, log_repairs=log_repairs)


def _download_worker(models_root: Path, cache_dir: Path) -> None:
    reporter = ProgressReporter(models_root, config.APP_LOG_DIR / "model-recovery-progress.txt"); reporter.start()
    try:
        _recover_models(models_root, cache_dir, reporter, verification_message="Model verification failed after download", log_repairs=False); reporter.finish(True); _set_state(state="ready", current_model=None, error=None)
    except Exception as exc:
        reporter.finish(False); logger.exception("AI model recovery failed"); _set_state(state="error", current_model=None, error=str(exc)[:2000])


def ensure_ready_sync(cancelled=None) -> dict[str, object]:
    models_root = config.MODELS_DIR.resolve()
    if all(is_valid(models_root, model) for model in MODELS): return status()

    with _condition:
        while _state["state"] == "downloading":
            if cancelled is not None and cancelled():
                raise ProcessingCancelledError(
                    "Cancelled while waiting for AI models")
            _condition.wait(timeout=0.2)
            if all(is_valid(models_root, model) for model in MODELS): return status()
        _state.update(state="downloading", current_model=None, error=None)

    reporter = ProgressReporter(
        models_root, config.APP_LOG_DIR / "model-recovery-progress.txt")
    reporter.start(); cache_dir = (config.CACHE_DIR / "model-downloads").resolve()
    try:
        _recover_models(models_root, cache_dir, reporter, verification_message="Model verification failed after recovery", log_repairs=True); reporter.finish(True); _set_state(state="ready", current_model=None, error=None); return status()
    except Exception as exc:
        reporter.finish(False); logger.exception("Synchronous AI model recovery failed"); _set_state(state="error", current_model=None, error=str(exc)[:2000]); raise


def start_download() -> dict[str, object]:
    with _lock:
        if _state["state"] == "downloading": return status()
        _state.update(state="downloading", current_model=None, error=None)

    models_root, cache_dir = config.MODELS_DIR.resolve(), (config.CACHE_DIR / 'model-downloads').resolve()
    threading.Thread(
        target=_download_worker,
        args=(models_root, cache_dir),
        name="ai-model-recovery",
        daemon=True,
    ).start()
    return status()
