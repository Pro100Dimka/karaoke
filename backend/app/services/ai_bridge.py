"""Integration layer between the FastAPI backend and AI Core 2026.

The AI package is a normal Python package at ``backend/AI``.  This module keeps
all backend-specific compatibility logic in one place so the AI core itself
remains independent from API schemas and legacy frontend artefacts.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from AI.audio import load_mono
from AI.engines.text import _vocal_activity_regions, tokenize
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
    bpm_override: float | None = None,
    key_override: str | None = None,
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
        bpm_override=bpm_override,
        key_override=key_override,
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
    candidate_words = line.get("words")
    raw_words: list[Any] = candidate_words if isinstance(candidate_words, list) else []

    words: list[dict[str, Any]] = []
    for raw in raw_words:
        if not isinstance(raw, dict):
            continue
        token = str(raw.get("word") or raw.get("text") or "").strip()
        if not token:
            continue
        raw_start = raw.get("start")
        raw_end = raw.get("end")
        word_start = max(start, float(start if raw_start is None else raw_start))
        word_end = min(
            end,
            max(word_start, float(word_start if raw_end is None else raw_end)),
        )
        words.append({"word": token, "start": word_start, "end": word_end})

    tokens = tokenize(text)
    old_tokens = [str(item["word"]) for item in words]
    if tokens != old_tokens:
        if words and len(tokens) == len(words):
            # A spelling-only correction must retain the accurate AI timing.
            words = [{**word, "word": token} for token, word in zip(tokens, words, strict=True)]
        else:
            # Inserted/deleted words have no trustworthy individual timestamps.
            # Rebuild only this line instead of leaving stale word labels that
            # make karaoke highlight a completely different sentence.
            words = []
            if tokens:
                span = max(0.0, end - start)
                weights = [max(1, len(token)) for token in tokens]
                total = sum(weights)
                cursor = 0
                for token, weight in zip(tokens, weights, strict=True):
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


def _source_line_boundaries(text: str, words: list[dict[str, Any]]) -> list[int]:
    """Map the lyricist's line breaks onto the aligned word timeline."""
    source_lines: list[str] = []
    for raw_line in str(text or "").splitlines():
        raw_line = raw_line.strip()
        if not tokenize(raw_line):
            continue
        if len(tokenize(raw_line)) <= 10:
            source_lines.append(raw_line)
            continue

        sentences = [
            sentence.strip()
            for sentence in re.split(r"(?<=[.!?…])\s+", raw_line)
            if tokenize(sentence)
        ]
        for sentence in sentences:
            if len(tokenize(sentence)) <= 10:
                source_lines.append(sentence)
                continue
            clauses = [
                clause.strip()
                for clause in re.split(r"(?<=[,;])\s+", sentence)
                if tokenize(clause)
            ]
            current: list[str] = []
            current_size = 0
            for clause in clauses:
                clause_size = len(tokenize(clause))
                if current and current_size + clause_size > 8:
                    source_lines.append(" ".join(current))
                    current = []
                    current_size = 0
                current.append(clause)
                current_size += clause_size
            if current:
                source_lines.append(" ".join(current))
    if len(source_lines) < 2:
        return []

    source_tokens = [token for line in source_lines for token in tokenize(line)]
    aligned_tokens = [item["word"] for item in words]
    matcher = SequenceMatcher(
        None,
        [token.casefold() for token in source_tokens],
        [token.casefold() for token in aligned_tokens],
        autojunk=False,
    )

    def map_boundary(source_index: int) -> int:
        for _tag, left_start, left_end, right_start, right_end in matcher.get_opcodes():
            if source_index > left_end:
                continue
            if left_end == left_start:
                return right_end
            ratio = (max(left_start, min(source_index, left_end)) - left_start) / (
                left_end - left_start
            )
            return round(right_start + ratio * (right_end - right_start))
        return len(aligned_tokens)

    boundaries: list[int] = []
    cursor = 0
    for line in source_lines[:-1]:
        cursor += len(tokenize(line))
        boundary = max(boundaries[-1] if boundaries else 0, map_boundary(cursor))
        boundaries.append(min(len(aligned_tokens), boundary))
    return boundaries


def _group_words_into_lines(
    words: list[dict[str, Any]], source_text: str = ""
) -> list[dict[str, Any]]:
    """Convert word-level AI alignment to the line format consumed by the UI."""
    if not words:
        return []

    normalized_words: list[dict[str, Any]] = []
    for word in words:
        if not isinstance(word, dict):
            continue
        token = str(word.get("text") or word.get("word") or "").strip()
        if not token:
            continue
        start = float(word.get("start") or 0.0)
        end = max(start, float(word.get("end") or start))
        normalized_words.append({"word": token, "start": start, "end": end})

    boundaries = _source_line_boundaries(source_text, normalized_words)
    if boundaries:
        lines: list[list[dict[str, Any]]] = []
        cursor = 0
        for boundary in [*boundaries, len(normalized_words)]:
            if boundary > cursor:
                lines.append(normalized_words[cursor:boundary])
            cursor = boundary
        return _lines_payload(lines)

    lines = []
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

    return _lines_payload(lines)


def _lines_payload(lines: list[list[dict[str, Any]]]) -> list[dict[str, Any]]:
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


def _snap_lines_to_regions(
    lines: list[dict[str, Any]], regions: list[tuple[float, float]]
) -> list[dict[str, Any]]:
    """Attach consecutive lyric lines to consecutive sung vocal regions."""
    if not lines or not regions:
        return lines
    result: list[dict[str, Any]] = []
    previous_region = -1
    for line in lines:
        old_start = float(line["start"])
        search_start = max(0, previous_region)
        candidates = range(search_start, min(len(regions), search_start + 8))
        region_index = min(
            candidates,
            key=lambda index: (
                abs(regions[index][0] - old_start)
                + (0.85 if index == previous_region else 0.0)
            ),
            default=previous_region,
        )
        if region_index < 0:
            result.append(line)
            continue
        region_start, region_end = regions[region_index]
        if region_end <= region_start:
            result.append(line)
            continue

        words = list(line.get("words") or [])
        old_end = float(line["end"])
        old_span = max(0.02, old_end - old_start)
        region_span = region_end - region_start
        timed_words = []
        for word in words:
            relative_start = max(
                0.0, min(1.0, (float(word["start"]) - old_start) / old_span)
            )
            relative_end = max(
                relative_start,
                min(1.0, (float(word["end"]) - old_start) / old_span),
            )
            timed_words.append(
                {
                    **word,
                    "start": region_start + region_span * relative_start,
                    "end": region_start + region_span * relative_end,
                }
            )
        result.append(
            {
                **line,
                "start": region_start,
                "end": region_end,
                "words": timed_words,
            }
        )
        previous_region = region_index
    return result


def _snap_lines_to_vocals(
    lines: list[dict[str, Any]], output_dir: Path
) -> list[dict[str, Any]]:
    vocals = next(
        (
            path
            for path in (
                output_dir / "separated" / "vocals.flac",
                output_dir / "separated" / "vocals.wav",
            )
            if path.is_file()
        ),
        None,
    )
    if vocals is None:
        return lines
    try:
        audio, sample_rate = load_mono(vocals, 16000)
        regions = _vocal_activity_regions(audio, sample_rate)
    except (OSError, RuntimeError, ValueError):
        return lines
    return _snap_lines_to_regions(lines, regions)


def _line_timing_is_impossible(line: dict[str, Any]) -> bool:
    words = list(line.get("words") or [])
    if not words:
        return True
    span = max(0.0, float(line.get("end") or 0.0) - float(line.get("start") or 0.0))
    return span < max(0.18, len(words) * 0.115)


def _active_offset_to_time(
    regions: list[tuple[float, float]], active_duration: float, offset: float
) -> float:
    remaining = max(0.0, min(active_duration, offset))
    for region_start, region_end in regions:
        region_span = max(0.0, region_end - region_start)
        if remaining <= region_span:
            return region_start + remaining
        remaining -= region_span
    return regions[-1][1]


def _repair_impossible_alignment_chunks(
    lines: list[dict[str, Any]], output_dir: Path, maximum_words: int = 38
) -> list[dict[str, Any]]:
    """Repair only consecutive impossible lines, preserving valid neighbours."""
    vocals = next(
        (
            path
            for path in (
                output_dir / "separated" / "vocals.flac",
                output_dir / "separated" / "vocals.wav",
            )
            if path.is_file()
        ),
        None,
    )
    if vocals is None or not lines:
        return lines
    try:
        audio, sample_rate = load_mono(vocals, 16000)
    except (OSError, RuntimeError, ValueError):
        return lines

    del maximum_words  # retained for compatibility with focused tests/callers
    groups: list[tuple[int, int]] = []
    index = 0
    while index < len(lines):
        if not _line_timing_is_impossible(lines[index]):
            index += 1
            continue
        end_index = index + 1
        while end_index < len(lines) and _line_timing_is_impossible(lines[end_index]):
            end_index += 1
        boundary_start = float(lines[index - 1]["end"]) if index > 0 else 0.0
        while end_index < len(lines):
            word_count = sum(
                len(line.get("words") or []) for line in lines[index:end_index]
            )
            available = float(lines[end_index]["start"]) - boundary_start
            if available >= max(0.18, word_count * 0.115):
                break
            end_index += 1
        groups.append((index, end_index))
        index = end_index

    result = list(lines)
    for first, after_last in groups:
        group = lines[first:after_last]
        start = float(lines[first - 1]["end"]) if first > 0 else 0.0
        end = float(lines[after_last]["start"]) if after_last < len(lines) else len(audio) / sample_rate
        end = max(start + 0.08, end)
        left = max(0, int(start * sample_rate))
        right = min(len(audio), max(left + 1, int(end * sample_rate)))
        regions = [
            (start + region_start, start + region_end)
            for region_start, region_end in _vocal_activity_regions(audio[left:right], sample_rate)
        ]
        if not regions:
            regions = [(start, end)]
        active_duration = sum(max(0.0, b - a) for a, b in regions)
        words = [word for line in group for word in list(line.get("words") or [])]
        if active_duration < len(words) * 0.115:
            # A locally adaptive energy threshold can miss breathy or heavily
            # processed vocals.  Never compress the text to the few surviving
            # peaks; retain the bounded chunk's wall-clock span instead.
            regions = [(start, end)]
            active_duration = end - start
        weights = [max(2, len(str(word.get("word") or word.get("text") or ""))) for word in words]
        total_weight = max(1, sum(weights))

        repaired_words: list[dict[str, Any]] = []
        consumed = 0
        for word, weight in zip(words, weights, strict=True):
            word_start = _active_offset_to_time(
                regions, active_duration, active_duration * consumed / total_weight
            )
            consumed += weight
            word_end = _active_offset_to_time(
                regions, active_duration, active_duration * consumed / total_weight
            )
            repaired_words.append({**word, "start": word_start, "end": max(word_start + 0.02, word_end)})

        cursor = 0
        for line_index, line in enumerate(group, first):
            size = len(line.get("words") or [])
            line_words = repaired_words[cursor : cursor + size]
            cursor += size
            result[line_index] = {
                **line,
                "start": line_words[0]["start"],
                "end": line_words[-1]["end"],
                "words": line_words,
            }
    return result


def _bound_legacy_word_durations(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep acoustic word starts while preventing highlights across long gaps."""
    output: list[dict[str, Any]] = []
    for line in lines:
        words = []
        for word in list(line.get("words") or []):
            start = float(word.get("start") or 0.0)
            end = max(start + 0.02, float(word.get("end") or start))
            token = str(word.get("word") or word.get("text") or "").strip()
            maximum = min(3.2, max(0.7, 0.42 + len(token) * 0.22))
            words.append({**word, "start": start, "end": min(end, start + maximum)})
        output.append(
            {
                **line,
                "start": words[0]["start"] if words else line.get("start", 0.0),
                "end": words[-1]["end"] if words else line.get("end", 0.0),
                "words": words,
            }
        )
    return output


def _reference_notes(output_dir: Path) -> list[dict[str, Any]]:
    # Prefer the exact canonical vocal-note sequence used to create vocal.mid.
    # reference.json remains a compatibility mirror, but must never hide a newer
    # detailed MIDI result behind separately simplified game notes.
    canonical = output_dir / ".ai-cache" / "vocal-notes.json"
    raw: Any = read_json(canonical, default={}) if canonical.exists() else read_json(output_dir / "reference.json", default={})
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
    word_payload: Any = read_json(output_dir / "lyricsSync.json", default={})
    words = word_payload.get("words", []) if isinstance(word_payload, dict) else []
    source_text = word_payload.get("text", "") if isinstance(word_payload, dict) else ""
    lines = _group_words_into_lines(words, source_text)
    # The canonical forced-alignment timeline is the single source of truth.
    # Never run a second timing redistribution while creating the legacy payload:
    # reference/MIDI use canonical seconds, so moving word starts here makes the
    # frontend lyric clock disagree with the melody even though both came from
    # the same processing run.  Keep starts exactly as lyricsSync.json produced
    # them; only cap implausibly long highlight ends for legacy UI compatibility.
    write_json(output_dir / "lyrics.json", _bound_legacy_word_durations(lines))

    song_map: Any = read_json(output_dir / "songMap.json", default={})
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
