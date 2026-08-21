
from __future__ import annotations

import math
from collections.abc import Callable
from pathlib import Path
from typing import Any

from AI.lyrics_document import flatten_word_notes, validate_lyrics_document
from AI.models import PitchFrame
from AI.notes import hz_to_midi
from AI.service import get_ai_service
from app.utils.json_files import read_json

ProgressCallback = Callable[[str, float, str], None]
CancelCallback = Callable[[], bool]


def process_song(
    source_path: str | Path,
    output_dir: str | Path,
    *,
    language: str | None = None,
    lyrics_path: str | Path | None = None,
    title: str | None = None,
    bpm_override: float | None = None,
    key_override: str | None = None,
    processing_mode: str = "auto",
    progress: ProgressCallback | None = None,
    cancelled: CancelCallback | None = None,
):
    result = get_ai_service().process_song(
        source_path=source_path,
        output_dir=output_dir,
        language=language,
        lyrics_path=lyrics_path,
        title=title,
        bpm_override=bpm_override,
        key_override=key_override,
        processing_mode=processing_mode,
        progress=progress,
        cancelled=cancelled,
    )
    return result



def _pitch_frame_to_legacy(frame: PitchFrame) -> dict[str, Any]:
    midi = hz_to_midi(
        frame.frequency) if frame.voiced and frame.frequency > 0 else None
    rounded = int(round(midi)) if midi is not None and math.isfinite(
        midi) else None
    return {
        "time": frame.time,
        "freq": frame.frequency,
        "frequency": frame.frequency,
        "midi": rounded,
        "note": rounded,
        "energy": frame.energy,
        "confidence": frame.confidence,
        "voiced": frame.voiced,
    }


def analyze_vocal(audio_path: str | Path) -> list[dict[str, Any]]:
    frames = get_ai_service().analyze_pitch(audio_path)
    return [_pitch_frame_to_legacy(frame) for frame in frames]


def reconcile_lyric_words(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [dict(line) for line in lines if isinstance(line, dict)]


def get_karaoke_lyrics(output_dir: str | Path) -> dict[str, Any]:
    payload: Any = read_json(Path(output_dir) / "lyricsSync.json", default={})
    try:
        return validate_lyrics_document(payload)
    except ValueError:
        return {}


def get_vocal_notes(output_dir: str | Path) -> list[dict[str, Any]]:
    lyrics = get_karaoke_lyrics(output_dir)
    return flatten_word_notes(lyrics) if lyrics else []


def get_game_notes(output_dir: str | Path) -> list[dict[str, Any]]:
    return get_vocal_notes(output_dir)


def get_syllables(_output_dir: str | Path) -> list[dict[str, Any]]:
    return []


def get_karaoke_timeline(output_dir: str | Path) -> dict[str, Any]:
    lyrics = get_karaoke_lyrics(output_dir)
    return {
        "duration": lyrics.get("duration", 0.0),
        "words": lyrics.get("words", []),
        "notes": get_vocal_notes(output_dir),
    }


def get_reference_notes(output_dir: str | Path) -> list[dict[str, Any]]:
    return get_vocal_notes(output_dir)
