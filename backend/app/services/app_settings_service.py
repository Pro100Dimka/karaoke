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
INSTALL_PREFERENCES_FILE = config.DATA_DIR.parent / "install-preferences.json"
_settings_lock = threading.RLock()

DEFAULT_SETTINGS: dict[str, Any] = {
    "language": "uk",
    "theme": "dark",
    "thread_count": min(4, max(1, (os.cpu_count() or 2) // 2)),
    "compute_mode": "auto",
    "online_name": "",
}

UI_PREFERENCES_FILE = config.DATA_DIR / "ui-preferences.json"
UI_PREFERENCE_NAMESPACES = frozenset({"audio", "karaoke", "melody_editor", "radio", "settings"})
INSTALL_PREFERENCE_VALUES = {
    "language": frozenset({"uk", "ru", "en"}),
    "theme": frozenset({"dark", "light", "green", "violet"}),
}


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


def _persist_path_settings(values: dict[str, str]) -> dict[str, Any]:
    try:
        existing: Any = read_json(PATH_SETTINGS_FILE, default={})
    except (json.JSONDecodeError, OSError):
        existing = {}
    roots = set(existing.get("song_library_roots", [])) if isinstance(existing, dict) else set()
    roots.update(str(path) for path in config.SONG_LIBRARY_ROOTS)
    roots.add(str(Path(values["songs_folder"]).expanduser().resolve()))
    payload = {**values, "song_library_roots": sorted(roots, key=str.casefold)}
    write_json(PATH_SETTINGS_FILE, payload)
    return payload


def _read_settings_unlocked() -> dict[str, Any]:
    try:
        raw: Any = read_json(SETTINGS_FILE, default={})
    except (json.JSONDecodeError, OSError):
        raw = {}
    stored = raw if isinstance(raw, dict) else {}
    try:
        install_preferences: Any = read_json(INSTALL_PREFERENCES_FILE, default={})
    except (json.JSONDecodeError, OSError):
        install_preferences = {}
    selected = (
        {
            key: value
            for key, value in install_preferences.items()
            if key in INSTALL_PREFERENCE_VALUES and value in INSTALL_PREFERENCE_VALUES[key]
        }
        if isinstance(install_preferences, dict)
        else {}
    )
    if selected:
        stored = {**stored, **selected}
        write_json(SETTINGS_FILE, stored)
    if INSTALL_PREFERENCES_FILE.exists():
        INSTALL_PREFERENCES_FILE.unlink(missing_ok=True)
    known_values = {key: stored[key] for key in DEFAULT_SETTINGS if key in stored}
    if "compute_mode" not in known_values:
        use_gpu = bool(stored.get("use_gpu", True))
        use_cpu = bool(stored.get("use_cpu", True))
        known_values["compute_mode"] = (
            "auto" if use_gpu and use_cpu else "cuda" if use_gpu else "cpu"
        )
    return {**DEFAULT_SETTINGS, **known_values, **path_settings()}


def read_settings() -> dict[str, Any]:
    with _settings_lock:
        return _read_settings_unlocked()


def update_settings(patch: dict[str, Any]) -> dict[str, Any]:
    """Validate the complete patch before publishing any persistent/runtime state."""
    with _settings_lock:
        current = _read_settings_unlocked()
        data = {**current, **patch}
        if data["compute_mode"] not in {"auto", "cuda", "cpu"}:
            raise ValueError("Unsupported AI compute mode")

        path_values = path_settings()
        labels = {"songs_folder": "Песни", "ai_folder": "AI-модели", "cache_folder": "Кэш"}
        for key in PATH_SETTING_KEYS:
            if key in patch:
                path_values[key] = _normalize_writable_directory(patch[key], labels[key])

        persisted = {key: data[key] for key in DEFAULT_SETTINGS if key in data}
        old_settings: Any = read_json(SETTINGS_FILE, default={})
        old_paths: Any = read_json(PATH_SETTINGS_FILE, default=path_settings())
        paths_changed = any(key in patch for key in PATH_SETTING_KEYS)
        ai_runtime_changed = "compute_mode" in patch or "thread_count" in patch or "ai_folder" in patch
        if ai_runtime_changed or paths_changed:
            from app.services import pipeline_service
            if pipeline_service.has_active_jobs():
                raise ValueError("Нельзя менять AI/хранилище, пока песни стоят в очереди или обрабатываются")
        try:
            persisted_paths = _persist_path_settings(path_values) if paths_changed else None
            write_json(SETTINGS_FILE, persisted)
            if persisted_paths is not None:
                config.apply_storage_paths(**persisted_paths)
            if ai_runtime_changed:
                from AI.service import reset_ai_service
                reset_ai_service()
            return _read_settings_unlocked()
        except Exception:
            write_json(SETTINGS_FILE, old_settings if isinstance(old_settings, dict) else {})
            if paths_changed:
                write_json(PATH_SETTINGS_FILE, old_paths if isinstance(old_paths, dict) else path_settings())
                if isinstance(old_paths, dict):
                    defaults = path_settings()
                    roots_value = old_paths.get("song_library_roots")
                    roots = (
                        [value for value in roots_value if isinstance(value, str)]
                        if isinstance(roots_value, list)
                        else None
                    )
                    config.apply_storage_paths(
                        songs_folder=str(old_paths.get("songs_folder", defaults["songs_folder"])),
                        ai_folder=str(old_paths.get("ai_folder", defaults["ai_folder"])),
                        cache_folder=str(old_paths.get("cache_folder", defaults["cache_folder"])),
                        song_library_roots=roots,
                    )
            raise


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
