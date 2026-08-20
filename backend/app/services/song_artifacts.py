
from __future__ import annotations

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


def is_internal_output_path(value: object) -> bool:
    parts = _parts(value)
    return True if not parts else any(part in _INTERNAL_OUTPUT_DIRS for part in parts) or any(part in _INTERNAL_OUTPUT_NAMES or part.startswith('.optimization-') for part in parts)


def is_portable_output_path(value: object) -> bool:
    parts = _parts(value)
    return False if not parts else not is_internal_output_path(value) and (not any(part in _LOCAL_ONLY_OUTPUT_DIRS for part in parts))


def _safe_relative(value: object) -> Path | None:
    if not isinstance(value, str) or not value.strip() or any(c in value for c in ("\\", ":", "\x00")): return None
    relative = PurePosixPath(value)
    return None if relative.is_absolute() or any(part in {'', '.', '..'} for part in relative.parts) else Path(*relative.parts)


def processing_outputs(output_dir: Path) -> dict[str, str]:
    return {
        key: name
        for key, name in {
            "instrumental": "instrumental.flac",
            "vocals": "vocals.flac",
            "lyricsSync": "lyricsSync.json",
        }.items()
        if (output_dir / name).is_file()
    }


def resolve_audio_artifact(output_dir: Path, key: str) -> Path | None:
    if key not in {"instrumental", "vocals"}: return None
    candidate = output_dir / f"{key}.flac"
    if candidate.is_file() and candidate.suffix.lower() in config.ALLOWED_AUDIO_EXTENSIONS:
        return candidate
    return None
