"""Locations for bundled AI models, shared by development and PyInstaller."""

from __future__ import annotations

import os
from pathlib import Path


def backend_dir() -> Path:
    return Path(__file__).resolve().parents[3]


def models_dir() -> Path:
    path = Path(os.getenv("SONGAPP_MODELS_DIR", backend_dir() / "models"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def whisper_dir() -> Path:
    path = models_dir() / "whisper"
    path.mkdir(parents=True, exist_ok=True)
    return path


def demucs_cache_dir() -> Path:
    path = models_dir() / "huggingface"
    path.mkdir(parents=True, exist_ok=True)
    return path


def game_model_dir() -> Path:
    bundled = models_dir() / "game" / "GAME-1.0.3-large-onnx"
    if bundled.exists():
        return bundled
    return backend_dir() / "engines" / "game" / "models" / "GAME-1.0.3-large-onnx"
