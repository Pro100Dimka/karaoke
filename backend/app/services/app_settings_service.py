"""Persistent application preferences shared by API endpoints and workers."""

from __future__ import annotations

import json
import threading
from typing import Any

import config
from app.utils.json_files import read_json, write_json

SETTINGS_FILE = config.DATA_DIR / "settings.json"
_settings_lock = threading.RLock()

DEFAULT_SETTINGS: dict[str, Any] = {
    "language": "ru",
    "theme": "dark",
    "whisper_model": config.DEFAULT_WHISPER_MODEL,
    "thread_count": 4,
    "use_gpu": True,
    "use_cpu": True,
    "autosave": True,
    "autoupdate": False,
    "online_name": "",
}


def path_settings() -> dict[str, str]:
    """Expose paths for display only; they are never persisted as preferences."""
    return {
        "songs_folder": str(config.SONG_OUTPUT_DIR),
        "ai_folder": str(config.MODELS_DIR),
        "cache_folder": str(config.DATA_DIR),
    }


def _read_settings_unlocked() -> dict[str, Any]:
    try:
        raw: Any = read_json(SETTINGS_FILE, default={})
    except (json.JSONDecodeError, OSError):
        raw = {}
    stored = raw if isinstance(raw, dict) else {}
    known_values = {key: stored[key] for key in DEFAULT_SETTINGS if key in stored}
    return {**DEFAULT_SETTINGS, **known_values, **path_settings()}


def read_settings() -> dict[str, Any]:
    with _settings_lock:
        return _read_settings_unlocked()


def update_settings(patch: dict[str, Any]) -> dict[str, Any]:
    """Merge and persist preferences without losing concurrent partial updates."""
    with _settings_lock:
        data = {**read_settings(), **patch}
        if not data["use_gpu"] and not data["use_cpu"]:
            raise ValueError("At least one AI compute target must remain enabled")
        persisted = {key: data[key] for key in DEFAULT_SETTINGS if key in data}
        write_json(SETTINGS_FILE, persisted)
        return read_settings()
