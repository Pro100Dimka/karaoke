"""Диагностика окружения: доступность ffmpeg/AI-моделей, версии, ошибки."""

import platform
import shutil
import subprocess

import config

BACKEND_VERSION = "0.1.0"


def _ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def _demucs_available() -> bool:
    try:
        import demucs  # noqa: F401

        return True
    except Exception:
        return False


def _whisper_available() -> bool:
    try:
        import whisper  # noqa: F401

        return True
    except Exception:
        try:
            import faster_whisper  # noqa: F401

            return True
        except Exception:
            return False


def _torch_info() -> tuple[bool, bool, str | None]:
    try:
        import torch

        return True, torch.cuda.is_available(), torch.__version__
    except Exception:
        return False, False, None


def pipeline_health() -> dict:
    torch_available, cuda_available, _ = _torch_info()
    return {
        "ffmpeg_available": _ffmpeg_available(),
        "demucs_available": _demucs_available(),
        "whisper_available": _whisper_available(),
        "torch_available": torch_available,
        "cuda_available": cuda_available,
        "ai_dir_found": config.AI_DIR.exists() and (config.AI_DIR / "run_all.py").exists(),
    }


def versions() -> dict:
    _, _, torch_version = _torch_info()
    components: dict[str, str | None] = {"torch": torch_version}

    try:
        result = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, timeout=5)
        components["ffmpeg"] = result.stdout.splitlines()[0] if result.stdout else None
    except Exception:
        components["ffmpeg"] = None

    for pkg in ("demucs", "whisper", "librosa", "pretty_midi"):
        try:
            module = __import__(pkg)
            components[pkg] = getattr(module, "__version__", "unknown")
        except Exception:
            components[pkg] = None

    return {
        "backend_version": BACKEND_VERSION,
        "python_version": platform.python_version(),
        "components": components,
    }


def recent_errors(limit: int = 20) -> list[dict]:
    """Собирает последние ошибки из pipeline.log всех песен, у которых
    статус ERROR — чтобы можно было быстро посмотреть, что пошло не так,
    не копаясь по файлам вручную."""
    import models
    from database import SessionLocal

    db = SessionLocal()
    try:
        errored = (
            db.query(models.Song)
            .filter(models.Song.status == models.SongStatus.ERROR)
            .order_by(models.Song.updated_at.desc())
            .limit(limit)
            .all()
        )
        return [
            {
                "song_id": s.id,
                "title": s.title,
                "error_message": s.error_message,
                "updated_at": s.updated_at.isoformat() if s.updated_at else None,
            }
            for s in errored
        ]
    finally:
        db.close()
