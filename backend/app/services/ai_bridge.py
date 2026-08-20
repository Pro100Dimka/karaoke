
from __future__ import annotations

import math
import re
from collections.abc import Callable
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from AI.engines.text import tokenize
from AI.models import PitchFrame
from AI.notes import hz_to_midi
from AI.service import get_ai_service
from AI.utils.numeric import int_or
from app.utils.json_files import read_json, write_json

ProgressCallback = Callable[[str, float, str], None]
CancelCallback = Callable[[], bool]


_int_or_default = int_or

def _note_syllable_indices(note: dict[str, Any]) -> tuple[int, ...]:
    raw = note.get("syllable_indices")
    values = raw if isinstance(raw, (list, tuple, set)) else (
        note.get("syllable_index"),)
    return tuple(dict.fromkeys(index for value in values if (index := _int_or_default(value)) >= 0))


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
    result = get_ai_service().process_song(
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


def _normalize_line_words(line: dict[str, Any]) -> dict[str, Any]:
    text, start = str(line.get('text') or '').strip(), max(0.0, float(line.get('start') or 0.0))
    end, candidate_words = max(start, float(line.get('end') or start)), line.get('words')
    raw_words: list[Any] = candidate_words if isinstance(
        candidate_words, list) else []

    words: list[dict[str, Any]] = []
    for raw in raw_words:
        if not isinstance(raw, dict): continue
        token = str(raw.get("word") or raw.get("text") or "").strip()
        if not token: continue
        raw_start = raw.get("start")
        raw_end = raw.get("end")
        word_start = max(start, float(
            start if raw_start is None else raw_start))
        word_end = min(
            end,
            max(word_start, float(word_start if raw_end is None else raw_end)),
        )
        words.append({"word": token, "start": word_start, "end": word_end})

    tokens, old_tokens = tokenize(text), [str(item['word']) for item in words]
    if tokens != old_tokens:
        if words and len(tokens) == len(words):
            words = [{**word, "word": token}
                     for token, word in zip(tokens, words, strict=True)]
        else:
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
                    words.append(
                        {"word": token, "start": word_start, "end": word_end})

    return {"text": text, "start": start, "end": end, "words": words}


def reconcile_lyric_words(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = [_normalize_line_words(line)
                  for line in lines if isinstance(line, dict)]
    normalized.sort(key=lambda line: (line["start"], line["end"]))
    return normalized


def _source_line_boundaries(text: str, words: list[dict[str, Any]]) -> list[int]:
    source_lines: list[str] = []
    for raw_line in str(text or "").splitlines():
        raw_line = raw_line.strip()
        if not tokenize(raw_line): continue
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
                clause.strip() for clause in re.split(r"(?<=[,;])\s+", sentence) if tokenize(clause)
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
            if current: source_lines.append(" ".join(current))
    if len(source_lines) < 2: return []

    source_tokens, aligned_tokens = [token for line in source_lines for token in tokenize(line)], [item['word'] for item in words]
    matcher = SequenceMatcher(
        None,
        [token.casefold() for token in source_tokens],
        [token.casefold() for token in aligned_tokens],
        autojunk=False,
    )

    def map_boundary(source_index: int) -> int:
        for _tag, left_start, left_end, right_start, right_end in matcher.get_opcodes():
            if source_index > left_end: continue
            if left_end == left_start: return right_end
            ratio = (max(left_start, min(source_index, left_end)) - left_start) / (
                left_end - left_start
            )
            return round(right_start + ratio * (right_end - right_start))
        return len(aligned_tokens)

    boundaries: list[int] = []
    cursor = 0
    for line in source_lines[:-1]:
        cursor += len(tokenize(line))
        boundary = max(
            boundaries[-1] if boundaries else 0, map_boundary(cursor))
        boundaries.append(min(len(aligned_tokens), boundary))
    return boundaries


def _normalized_word(word: object) -> dict[str, Any] | None:
    if not isinstance(word, dict) or not (token := str(word.get("text") or word.get("word") or "").strip()): return None
    start = float(word.get("start") or 0.0)
    return {**word, "word": token, "text": token, "start": start, "end": max(start, float(word.get("end") or start))}



def _artifact_list(output_dir: Path, key: str, *files: str) -> list[dict[str, Any]]:
    for name in files:
        payload: Any = read_json(output_dir / name, default={})
        if isinstance(payload, dict) and isinstance(items := payload.get(key), list): return [item for item in items if isinstance(item, dict)]
    return []


def _notes_with_midi(notes: object) -> list[dict[str, Any]]:
    if not isinstance(notes, list): return []
    return [{**note, "midi": (midi := note.get("midi_note", note.get("midi"))), "pitch": midi} for note in notes if isinstance(note, dict)]


def _group_words_into_lines(
    words: list[dict[str, Any]], source_text: str = ""
) -> list[dict[str, Any]]:
    if not words: return []

    normalized_words = [item for word in words if (item := _normalized_word(word)) is not None]

    if boundaries := _source_line_boundaries(source_text, normalized_words):
        lines: list[list[dict[str, Any]]] = []
        cursor = 0
        for boundary in [*boundaries, len(normalized_words)]:
            if boundary > cursor: lines.append(normalized_words[cursor:boundary])
            cursor = boundary
        return _lines_payload(lines)

    lines = []
    current: list[dict[str, Any]] = []
    sentence_end = re.compile(r"[.!?…]+$")

    for item in normalized_words:
        token, start, end = item["word"], item["start"], item["end"]
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

    if current: lines.append(current)

    return _lines_payload(lines)


def _lines_payload(lines: list[list[dict[str, Any]]]) -> list[dict[str, Any]]: return [{'text': ' '.join(item['word'] for item in line), 'start': line[0]['start'], 'end': line[-1]['end'], 'words': line} for line in lines if line]


def _bound_legacy_word_durations(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for line in lines:
        words = []
        for word in list(line.get("words") or []):
            start = float(word.get("start") or 0.0)
            end = max(start + 0.02, float(word.get("end") or start))
            token = str(word.get("word") or word.get("text") or "").strip()
            maximum = min(3.2, max(0.7, 0.42 + len(token) * 0.22))
            words.append(
                {**word, "start": start, "end": min(end, start + maximum)})
        output.append(
            {
                **line,
                "start": words[0]["start"] if words else line.get("start", 0.0),
                "end": words[-1]["end"] if words else line.get("end", 0.0),
                "words": words,
            }
        )
    return output


def get_karaoke_lyrics(output_dir: str | Path) -> dict[str, Any]:
    payload: Any = read_json(Path(output_dir) / "lyricsSync.json", default={})
    if not isinstance(payload, dict) or not isinstance(payload.get("words"), list): return {}
    return payload


def get_game_notes(output_dir: str | Path) -> list[dict[str, Any]]: return _notes_with_midi(_artifact_list(Path(output_dir), 'notes', 'songMap.json', 'reference.json'))


def get_syllables(output_dir: str | Path) -> list[dict[str, Any]]: return _artifact_list(Path(output_dir), 'syllables', 'songMap.json', 'syllables.json')

def get_karaoke_timeline(output_dir: str | Path) -> dict[str, Any]:
    payload: Any = read_json(Path(output_dir) / "songMap.json", default={})
    if (
        isinstance(payload, dict)
        and isinstance(payload.get("lines"), list)
        and isinstance(payload.get("display_notes"), list)
    ):
        from app.services.song_editor_service import normalize_editor_timeline

        normalize_editor_timeline(payload)
        return payload
    return _build_legacy_karaoke_timeline(output_dir)


def _build_legacy_karaoke_timeline(output_dir: str | Path) -> dict[str, Any]:
    output_dir = Path(output_dir)
    lyrics_sync = get_karaoke_lyrics(output_dir)
    lines = _group_words_into_lines(
        lyrics_sync.get("words", []), str(lyrics_sync.get("text") or "")
    )
    syllables, notes = get_syllables(output_dir), get_game_notes(output_dir)
    song_map: Any = read_json(output_dir / "songMap.json", default={})

    syllables_by_word: dict[int, list[dict[str, Any]]] = {}
    for syllable in syllables:
        word_index = _int_or_default(syllable.get("word_index"))
        if word_index < 0: continue
        syllables_by_word.setdefault(word_index, []).append(dict(syllable))

    notes_by_syllable: dict[int, list[dict[str, Any]]] = {}
    for note in notes:
        for syllable_index in _note_syllable_indices(note): notes_by_syllable.setdefault(syllable_index, []).append(dict(note))

    for values in syllables_by_word.values():
        values.sort(key=lambda item: (
            float(item.get("start") or 0.0), int(item.get("index") or 0)))
    for values in notes_by_syllable.values():
        values.sort(
            key=lambda item: (float(item.get("start") or 0.0),
                              float(item.get("end") or 0.0))
        )

    timeline_lines: list[dict[str, Any]] = []
    for line_index, line in enumerate(lines):
        timeline_words: list[dict[str, Any]] = []
        for source_word in list(line.get("words") or []):
            word = dict(source_word)
            word_index = _int_or_default(word.get("index"))

            linked_syllables: list[dict[str, Any]] = []
            for source_syllable in syllables_by_word.get(word_index, []):
                syllable = dict(source_syllable)
                syllable_index = _int_or_default(syllable.get("index"))
                linked_notes = notes_by_syllable.get(syllable_index, [])
                linked_syllables.append(
                    {
                        **syllable,
                        "timing_source": "syllable_alignment",
                        "notes": linked_notes,
                    }
                )

            timeline_words.append(
                {
                    **word,
                    "timing_source": "word_alignment",
                    "syllables": linked_syllables,
                }
            )

        if timeline_words:
            line_start = min(float(word["start"]) for word in timeline_words)
            line_end = max(float(word["end"]) for word in timeline_words)
        else:
            line_start = float(line.get("start") or 0.0)
            line_end = max(line_start, float(line.get("end") or line_start))
        timeline_lines.append(
            {
                **line,
                "index": line_index,
                "start": line_start,
                "end": line_end,
                "words": timeline_words,
            }
        )

    duration = 0.0
    if isinstance(song_map, dict):
        try:
            duration = max(0.0, float(song_map.get("duration") or 0.0))
        except (TypeError, ValueError):
            duration = 0.0
    if not duration:
        candidates = [float(line.get("end") or 0.0) for line in timeline_lines]
        candidates.extend(float(note.get("end") or 0.0) for note in notes)
        duration = max(candidates, default=0.0)

    return {
        "version": 1,
        "clock": "instrumental_seconds",
        "duration": duration,
        "lines": timeline_lines,
        "notes": notes,
    }


def _reference_notes(output_dir: Path) -> list[dict[str, Any]]:
    canonical, legacy_cache = output_dir / 'acousticNotes.json', output_dir / '.ai-cache' / 'vocal-notes.json'
    if canonical.exists():
        raw: Any = read_json(canonical, default={})
    elif legacy_cache.exists():
        raw = read_json(legacy_cache, default={})
    else:
        raw = read_json(output_dir / "reference.json", default={})
    notes = raw.get("notes", []) if isinstance(raw, dict) else raw if isinstance(raw, list) else []
    return _notes_with_midi(notes)


def get_reference_notes(output_dir: str | Path) -> list[dict[str, Any]]: return _reference_notes(Path(output_dir))


def ensure_legacy_artifacts(output_dir: Path, *, title: str | None = None) -> None:
    output_dir = Path(output_dir)
    word_payload: Any = read_json(output_dir / "lyricsSync.json", default={})
    words, source_text = word_payload.get('words', []) if isinstance(word_payload, dict) else [], word_payload.get('text', '') if isinstance(word_payload, dict) else ''
    lines = _group_words_into_lines(words, source_text)
    write_json(output_dir / "lyrics.json", _bound_legacy_word_durations(lines))

    song_map: Any = read_json(output_dir / "songMap.json", default={})
    if not isinstance(song_map, dict): song_map = {}
    song_info = dict(song_map)
    if title: song_info.setdefault("title", title)
    write_json(output_dir / "songInfo.json", song_info)

    notes, duration = _reference_notes(output_dir), float(song_map.get('duration') or 0.0)
    midi_values = [int(note["midi"])
                   for note in notes if note.get("midi") is not None]
    note_range, density = max(midi_values) - min(midi_values) if midi_values else 0, len(notes) / duration if duration > 0 else 0.0
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
        structure = [{"label": "Песня", "name": "song",
                      "start": 0.0, "end": duration}]
    write_json(output_dir / "structure.json", structure)
    write_json(output_dir / "breaths.json", [])
