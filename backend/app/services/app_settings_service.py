"""Persistent application preferences shared by API endpoints and workers."""

from __future__ import annotations

import json
import os
from typing import Any

import config

SETTINGS_FILE = config.DATA_DIR / "settings.json"
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
        "songs_folder": str(config.FULL_SONGS_DIR),
        "ai_folder": str(config.AI_DIR),
        "recordings_folder": str(config.SONG_OUTPUT_DIR),
        "cache_folder": str(config.DATA_DIR),
    }


def read_settings() -> dict[str, Any]:
    try:
        raw = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        raw = {}
    stored = raw if isinstance(raw, dict) else {}
    known_values = {key: stored[key] for key in DEFAULT_SETTINGS if key in stored}
    return {**DEFAULT_SETTINGS, **known_values, **path_settings()}


def update_settings(patch: dict[str, Any]) -> dict[str, Any]:
    """Atomically persist known preferences and return their display representation."""
    data = {**read_settings(), **patch}
    persisted = {key: data[key] for key in DEFAULT_SETTINGS if key in data}
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary_file = SETTINGS_FILE.with_suffix(".tmp")
    with temporary_file.open("w", encoding="utf-8") as file:
        json.dump(persisted, file, ensure_ascii=False, indent=2)
        file.flush()
        os.fsync(file.fileno())
    temporary_file.replace(SETTINGS_FILE)
    return read_settings()
