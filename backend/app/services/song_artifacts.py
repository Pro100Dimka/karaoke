
from __future__ import annotations

import json
from pathlib import Path, PurePosixPath

import config

_AUDIO_EXTENSIONS = (".flac", ".mp3", ".wav", ".m4a", ".ogg", ".aac")
_INTERNAL_OUTPUT_NAMES = {".optimization-journal.json", ".pipeline.lock"}
_INTERNAL_OUTPUT_DIRS = {".ai-cache"}
_LOCAL_ONLY_OUTPUT_DIRS = {config.LOGS_DIRNAME, config.RECORDINGS_DIRNAME}


def _parts(value: object) -> tuple[str, ...] | None:
    if isinstance(value, (Path, PurePosixPath)): return tuple(value.parts)
    if isinstance(value, str):
        if "\\" in value or "\x00" in value: return None
        return tuple(PurePosixPath(value).parts)
    return None


def is_internal_output_path(value: object) -> bool: parts = _parts(value); return True if not parts else any((part in _INTERNAL_OUTPUT_DIRS for part in parts)) or any((part in _INTERNAL_OUTPUT_NAMES or part.startswith('.optimization-') for part in parts))


def is_portable_output_path(value: object) -> bool: parts = _parts(value); return False if not parts else not is_internal_output_path(value) and (not any((part in _LOCAL_ONLY_OUTPUT_DIRS for part in parts)))


def _safe_relative(value: object) -> Path | None:
    if not isinstance(value, str) or not value.strip() or any(c in value for c in ("\\", ":", "\x00")): return None
    relative = PurePosixPath(value); return None if relative.is_absolute() or any((part in {'', '.', '..'} for part in relative.parts)) else Path(*relative.parts)


def _manifest_payload(output_dir: Path) -> dict | None:
    try: payload = json.loads((output_dir / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError, UnicodeDecodeError): return None
    return payload if isinstance(payload, dict) else None


def processing_outputs(output_dir: Path) -> dict[str, str]:
    payload = _manifest_payload(output_dir); outputs = payload.get("outputs") if payload is not None else None
    if not isinstance(outputs, dict): return {}
    result: dict[str, str] = {}
    for key, value in outputs.items():
        relative = _safe_relative(value)
        if isinstance(key, str) and relative is not None: result[key] = relative.as_posix()
    return result


def _manifest_output_state(output_dir: Path, key: str) -> tuple[bool, Path | None]:
    payload = _manifest_payload(output_dir); outputs = payload.get("outputs") if payload is not None else None
    if not isinstance(outputs, dict) or key not in outputs: return False, None
    relative = _safe_relative(outputs.get(key))
    if relative is None: return True, None
    root, candidate = output_dir.resolve(), (output_dir / relative).resolve(); return (True, None) if candidate == root or root not in candidate.parents else (True, candidate if candidate.is_file() else None)


def resolve_manifest_output(output_dir: Path, key: str) -> Path | None: return _manifest_output_state(output_dir, key)[1]


def resolve_audio_artifact(output_dir: Path, key: str) -> Path | None:
    declared, manifest_path = _manifest_output_state(output_dir, key)
    if declared:
        if manifest_path is None or manifest_path.suffix.lower() not in config.ALLOWED_AUDIO_EXTENSIONS: return None
        return manifest_path

    bases = [output_dir]
    if key in {"instrumental", "vocals"}: bases.insert(0, output_dir / "separated")
    for base in bases:
        for extension in _AUDIO_EXTENSIONS:
            candidate = base / f"{key}{extension}"
            if candidate.is_file() and candidate.suffix.lower() in config.ALLOWED_AUDIO_EXTENSIONS: return candidate
    return None
