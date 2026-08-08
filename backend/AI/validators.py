from __future__ import annotations

import json
import math
from collections.abc import Iterable
from pathlib import Path

import soundfile as sf

from .errors import InvalidArtifactError
from .midi import validate_midi
from .models import PitchFrame, Syllable, VocalNote, Word


def validate_audio(path: str | Path):
    source = Path(path)
    if not source.is_file() or source.stat().st_size < 44:
        raise InvalidArtifactError(f"Missing or truncated audio: {source}")
    try:
        info = sf.info(source)
    except (RuntimeError, OSError) as exc:
        raise InvalidArtifactError(f"Unreadable audio {source}: {exc}") from exc
    if info.frames <= 0 or info.samplerate <= 0 or info.channels <= 0:
        raise InvalidArtifactError(f"Empty audio: {source}")
    return info


def validate_json(path: str | Path, required: Iterable[str] = ()):
    source = Path(path)
    try:
        data = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise InvalidArtifactError(f"Invalid JSON {source}: {exc}") from exc
    if not isinstance(data, dict):
        raise InvalidArtifactError(f"Expected JSON object in {source}")
    for key in required:
        if key not in data:
            raise InvalidArtifactError(f"{source} missing required key {key!r}")
    return data


def validate_timeline(items, name: str = "timeline") -> None:
    previous_start = -1.0
    for index, item in enumerate(items):
        start = float(getattr(item, "start", getattr(item, "time", 0.0)))
        end = float(getattr(item, "end", start))
        if not math.isfinite(start) or not math.isfinite(end):
            raise InvalidArtifactError(f"Non-finite {name} item {index}")
        if start < 0 or end < start:
            raise InvalidArtifactError(f"Invalid {name} item {index}: {start}..{end}")
        if start + 1e-6 < previous_start:
            raise InvalidArtifactError(f"{name} is not sorted at item {index}")
        previous_start = start


def validate_within_duration(items, duration: float, name: str, tolerance: float = 0.1) -> None:
    if not math.isfinite(duration) or duration <= 0:
        raise InvalidArtifactError(f"Invalid audio duration for {name}: {duration}")
    limit = duration + max(0.0, tolerance)
    for index, item in enumerate(items):
        end = float(getattr(item, "end", getattr(item, "time", 0.0)))
        if not math.isfinite(end) or end > limit:
            raise InvalidArtifactError(
                f"{name} item {index} ends outside audio: {end:.3f}s > {duration:.3f}s"
            )


def validate_pitch(frames) -> None:
    previous_time = -1.0
    for index, frame in enumerate(frames):
        values = (frame.time, frame.frequency, frame.confidence, frame.energy)
        if not all(math.isfinite(float(value)) for value in values):
            raise InvalidArtifactError(f"Non-finite pitch value at frame {index}")
        if frame.time + 1e-9 < previous_time:
            raise InvalidArtifactError(f"Pitch timeline is not sorted at frame {index}")
        if frame.time < 0 or frame.frequency < 0:
            raise InvalidArtifactError(f"Negative pitch value at frame {index}")
        if not 0 <= frame.confidence <= 1:
            raise InvalidArtifactError(f"Pitch confidence is out of range at frame {index}")
        if frame.voiced and frame.frequency <= 0:
            raise InvalidArtifactError(f"Voiced pitch frame {index} has no positive frequency")
        previous_time = frame.time


def validate_pitch_json(path: str | Path):
    source = Path(path)
    try:
        data = json.loads(source.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            raise TypeError("expected a JSON array")
        frames = [PitchFrame(**item) for item in data]
        validate_pitch(frames)
        return frames
    except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError) as exc:
        raise InvalidArtifactError(f"Invalid pitch JSON {source}: {exc}") from exc


def validate_derivation_json(path: str | Path, kind: str):
    source = Path(path)
    try:
        data = json.loads(source.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise TypeError("expected a JSON object")
        mapping = {
            "syllables": ("syllables", Syllable),
            "notes": ("notes", VocalNote),
            "frames": ("frames", PitchFrame),
        }
        key, cls = mapping[kind]
        items = data.get(key)
        if not isinstance(items, list):
            raise TypeError(f"{key} must be an array")
        values = [cls(**item) for item in items]
        if kind == "frames":
            validate_pitch(values)
        else:
            validate_timeline(values, kind)
        return values
    except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError) as exc:
        raise InvalidArtifactError(f"Invalid {kind} JSON {source}: {exc}") from exc


__all__ = [
    "validate_audio",
    "validate_json",
    "validate_midi",
    "validate_pitch",
    "validate_pitch_json",
    "validate_derivation_json",
    "validate_timeline",
    "validate_within_duration",
    "validate_words_json",
    "validate_music_json",
]


def validate_words_json(path: str | Path):
    source = Path(path)
    try:
        data = json.loads(source.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise TypeError("expected a JSON object")
        text = data.get("text")
        items = data.get("words")
        if not isinstance(text, str) or not isinstance(items, list):
            raise TypeError("expected string text and array words")
        words = [Word(**item) for item in items]
        validate_timeline(words, "words")
        return words
    except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError) as exc:
        raise InvalidArtifactError(f"Invalid words JSON {source}: {exc}") from exc


def validate_music_json(path: str | Path) -> float:
    data = validate_json(path, ("bpm",))
    try:
        bpm = float(data["bpm"])
    except (TypeError, ValueError) as exc:
        raise InvalidArtifactError(f"Invalid BPM in {path}: {exc}") from exc
    if not math.isfinite(bpm) or not 20.0 <= bpm <= 300.0:
        raise InvalidArtifactError(f"BPM out of range in {path}: {bpm}")
    return bpm
