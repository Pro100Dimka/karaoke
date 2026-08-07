"""Integration layer between the FastAPI backend and AI Core 2026.

The AI package is a normal Python package at ``backend/AI``.  This module keeps
all backend-specific compatibility logic in one place so the AI core itself
remains independent from API schemas and legacy frontend artefacts.
"""

from __future__ import annotations

from pathlib import Path
import math
import re
from typing import Any, Callable

from AI.engines.text import tokenize
from AI.models import PitchFrame
from AI.notes import hz_to_midi
from AI.service import AICoreService, get_ai_service
from app.utils.json_files import read_json, write_json

ProgressCallback = Callable[[str, float, str], None]
CancelCallback = Callable[[], bool]


def get_service() -> AICoreService:
    """Return the single long-lived AI service used by the backend process."""
    return get_ai_service()


def process_song(
    source_path: str | Path,
    output_dir: str | Path,
    *,
    language: str | None = None,
    lyrics_path: str | Path | None = None,
    title: str | None = None,
    progress: ProgressCallback | None = None,
    cancelled: CancelCallback | None = None,
):
    """Run AI Core and publish compatibility artefacts required by current UI."""
    result = get_service().process_song(
        source_path=source_path,
        output_dir=output_dir,
        language=language,
        lyrics_path=lyrics_path,
        title=title,
        progress=progress,
        cancelled=cancelled,
    )
    ensure_legacy_artifacts(Path(output_dir), title=title)
    return result



def get_run_all_pipeline():
    """Legacy callable kept for tests/extensions while using AI Core internally."""
    def _run(source_path, output_dir, whisper_model=None, language=None, **kwargs):
        del whisper_model
        return process_song(
            source_path,
            output_dir,
            language=language,
            **kwargs,
        )

    return _run

def _pitch_frame_to_legacy(frame: PitchFrame) -> dict[str, Any]:
    midi = hz_to_midi(frame.frequency) if frame.voiced and frame.frequency > 0 else None
    rounded = int(round(midi)) if midi is not None and math.isfinite(midi) else None
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
    """Analyze a recorded vocal take using the same pitch engine as AI Core."""
    frames = get_service().analyze_pitch(audio_path)
    return [_pitch_frame_to_legacy(frame) for frame in frames]


def get_analyze_vocal():
    """Compatibility for the existing recording-analysis service."""
    return analyze_vocal


def _normalize_line_words(line: dict[str, Any]) -> dict[str, Any]:
    text = str(line.get("text") or "").strip()
    start = max(0.0, float(line.get("start") or 0.0))
    end = max(start, float(line.get("end") or start))
    raw_words = line.get("words") if isinstance(line.get("words"), list) else []

    words: list[dict[str, Any]] = []
    for raw in raw_words:
        if not isinstance(raw, dict):
            continue
        token = str(raw.get("word") or raw.get("text") or "").strip()
        if not token:
            continue
        word_start = max(start, float(raw.get("start") if raw.get("start") is not None else start))
        word_end = min(end, max(word_start, float(raw.get("end") if raw.get("end") is not None else word_start)))
        words.append({"word": token, "start": word_start, "end": word_end})

    if not words and text:
        tokens = tokenize(text)
        if tokens:
            span = max(0.0, end - start)
            weights = [max(1, len(token)) for token in tokens]
            total = sum(weights)
            cursor = 0
            for token, weight in zip(tokens, weights):
                word_start = start + span * cursor / total
                cursor += weight
                word_end = start + span * cursor / total
                words.append({"word": token, "start": word_start, "end": word_end})

    return {"text": text, "start": start, "end": end, "words": words}


def reconcile_lyric_words(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Normalize manually edited lyric lines without depending on old AI modules."""
    normalized = [_normalize_line_words(line) for line in lines if isinstance(line, dict)]
    normalized.sort(key=lambda line: (line["start"], line["end"]))
    return normalized


def get_reconcile_lyric_words():
    return reconcile_lyric_words


def _group_words_into_lines(words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert word-level AI alignment to the line format consumed by the UI."""
    if not words:
        return []

    lines: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    sentence_end = re.compile(r"[.!?…]+$")

    for word in words:
        if not isinstance(word, dict):
            continue
        token = str(word.get("text") or word.get("word") or "").strip()
        if not token:
            continue
        start = float(word.get("start") or 0.0)
        end = max(start, float(word.get("end") or start))
        item = {"word": token, "start": start, "end": end}

        if current:
            gap = start - current[-1]["end"]
            line_duration = end - current[0]["start"]
            if gap >= 0.9 or len(current) >= 8 or line_duration >= 7.0:
                lines.append(current)
                current = []
        current.append(item)
        if sentence_end.search(token) and len(current) >= 2:
            lines.append(current)
            current = []

    if current:
        lines.append(current)

    return [
        {
            "text": " ".join(item["word"] for item in line),
            "start": line[0]["start"],
            "end": line[-1]["end"],
            "words": line,
        }
        for line in lines
        if line
    ]


def _reference_notes(output_dir: Path) -> list[dict[str, Any]]:
    raw = read_json(output_dir / "reference.json", default={})
    notes = raw.get("notes", []) if isinstance(raw, dict) else raw if isinstance(raw, list) else []
    result: list[dict[str, Any]] = []
    for note in notes:
        if not isinstance(note, dict):
            continue
        midi = note.get("midi_note", note.get("midi"))
        result.append(
            {
                **note,
                "midi": midi,
                "pitch": midi,
            }
        )
    return result


def get_reference_notes(output_dir: str | Path) -> list[dict[str, Any]]:
    return _reference_notes(Path(output_dir))


def ensure_legacy_artifacts(output_dir: Path, *, title: str | None = None) -> None:
    """Create small compatibility JSON files expected by the current frontend.

    Canonical AI Core files are never overwritten.  These files can be removed
    once the frontend consumes ``lyricsSync.json`` and ``songMap.json`` directly.
    """
    output_dir = Path(output_dir)
    word_payload = read_json(output_dir / "lyricsSync.json", default={})
    words = word_payload.get("words", []) if isinstance(word_payload, dict) else []
    write_json(output_dir / "lyrics.json", _group_words_into_lines(words))

    song_map = read_json(output_dir / "songMap.json", default={})
    if not isinstance(song_map, dict):
        song_map = {}
    song_info = dict(song_map)
    if title:
        song_info.setdefault("title", title)
    write_json(output_dir / "songInfo.json", song_info)

    notes = _reference_notes(output_dir)
    duration = float(song_map.get("duration") or 0.0)
    midi_values = [int(note["midi"]) for note in notes if note.get("midi") is not None]
    note_range = max(midi_values) - min(midi_values) if midi_values else 0
    density = len(notes) / duration if duration > 0 else 0.0
    score = min(100, round(note_range * 2.2 + density * 16))
    level = "easy" if score < 35 else "medium" if score < 65 else "hard"
    write_json(
        output_dir / "difficulty.json",
        {
            "score": score,
            "level": level,
            "note_count": len(notes),
            "note_range_semitones": note_range,
            "notes_per_second": round(density, 3),
        },
    )

    structure = []
    if duration > 0:
        structure = [{"label": "Песня", "name": "song", "start": 0.0, "end": duration}]
    write_json(output_dir / "structure.json", structure)
    write_json(output_dir / "breaths.json", [])
