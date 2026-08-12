"""Persistent application preferences shared by API endpoints and workers."""

from __future__ import annotations

import json
import os
import threading
from copy import deepcopy
from pathlib import Path
from typing import Any

import config
from app.utils.json_files import read_json, write_json

SETTINGS_FILE = config.DATA_DIR / "settings.json"
PATH_SETTINGS_FILE = config.PATH_SETTINGS_FILE
_settings_lock = threading.RLock()

DEFAULT_SETTINGS: dict[str, Any] = {
    "language": "uk",
    "theme": "dark",
    "whisper_model": config.DEFAULT_WHISPER_MODEL,
    "thread_count": min(4, max(1, (os.cpu_count() or 2) // 2)),
    "use_gpu": True,
    "use_cpu": True,
    "autosave": True,
    "autoupdate": False,
    "online_name": "",
}

UI_PREFERENCES_FILE = config.DATA_DIR / "ui-preferences.json"
UI_PREFERENCE_NAMESPACES = frozenset({"audio", "karaoke", "melody_editor", "radio", "settings"})


def path_settings() -> dict[str, str]:
    """Return the storage paths currently used by the backend."""
    return {
        "songs_folder": str(config.SONG_OUTPUT_DIR),
        "ai_folder": str(config.MODELS_DIR),
        "cache_folder": str(config.CACHE_DIR),
    }


PATH_SETTING_KEYS = ("songs_folder", "ai_folder", "cache_folder")


def _normalize_writable_directory(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label}: выберите папку")
    path = Path(value).expanduser().resolve()
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / f".advoice-write-test-{os.getpid()}"
        probe.write_bytes(b"")
        probe.unlink(missing_ok=True)
    except OSError as exc:
        raise ValueError(f"Нет доступа на запись в папку {label}: {path}") from exc
    return str(path)


def _persist_path_settings(values: dict[str, str]) -> None:
    write_json(PATH_SETTINGS_FILE, values)


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
    """Merge preferences and immediately apply user-selected storage paths."""
    with _settings_lock:
        data = {**read_settings(), **patch}
        if not data["use_gpu"] and not data["use_cpu"]:
            raise ValueError("At least one AI compute target must remain enabled")

        persisted = {key: data[key] for key in DEFAULT_SETTINGS if key in data}
        write_json(SETTINGS_FILE, persisted)

        current_paths = path_settings()
        path_values = dict(current_paths)
        labels = {
            "songs_folder": "Песни",
            "ai_folder": "AI-модели",
            "cache_folder": "Кэш",
        }
        for key in PATH_SETTING_KEYS:
            if key in patch:
                path_values[key] = _normalize_writable_directory(patch[key], labels[key])

        if any(key in patch for key in PATH_SETTING_KEYS):
            _persist_path_settings(path_values)
            config.apply_storage_paths(**path_values)

        return read_settings()


def read_ui_preferences() -> dict[str, dict[str, Any]]:
    with _settings_lock:
        try:
            raw: Any = read_json(UI_PREFERENCES_FILE, default={})
        except (json.JSONDecodeError, OSError):
            raw = {}
        if not isinstance(raw, dict):
            return {}
        return {
            namespace: deepcopy(value)
            for namespace, value in raw.items()
            if namespace in UI_PREFERENCE_NAMESPACES and isinstance(value, dict)
        }


def update_ui_preferences(namespace: str, patch: dict[str, Any]) -> dict[str, Any]:
    if namespace not in UI_PREFERENCE_NAMESPACES:
        raise ValueError(f"Unknown preference namespace: {namespace}")
    encoded = json.dumps(patch, ensure_ascii=False)
    if len(encoded.encode("utf-8")) > 32_768:
        raise ValueError("Preference payload is too large")
    with _settings_lock:
        stored = read_ui_preferences()
        current = stored.get(namespace, {})
        stored[namespace] = {**current, **deepcopy(patch)}
        write_json(UI_PREFERENCES_FILE, stored)
        return deepcopy(stored[namespace])
