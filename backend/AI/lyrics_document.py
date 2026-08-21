from __future__ import annotations

import math
from typing import Any

from .models import VocalNote, Word, to_dict

_EPSILON = 1e-9


def _number(value: Any, name: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a number") from exc
    if not math.isfinite(number):
        raise ValueError(f"{name} must be finite")
    return number


def validate_lyrics_document(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict) or not isinstance(payload.get("words"), list):
        raise ValueError("lyricsSync.json must contain a words array")
    bpm = _number(payload.get("bpm"), "bpm")
    if bpm <= 0:
        raise ValueError("bpm must be greater than zero")
    if not isinstance(payload.get("key"), str) or not payload["key"].strip():
        raise ValueError("key must be a non-empty string")
    for position, word in enumerate(payload["words"]):
        if not isinstance(word, dict):
            raise ValueError(f"words[{position}] must be an object")
        if not isinstance(word.get("text"), str) or not word["text"].strip():
            raise ValueError(f"words[{position}].text must be a non-empty string")
        start = _number(word.get("start"), f"words[{position}].start")
        end = _number(word.get("end"), f"words[{position}].end")
        if start < 0 or end <= start:
            raise ValueError(f"words[{position}] has an invalid interval")
        notes = word.get("notes")
        if not isinstance(notes, list):
            raise ValueError(f"words[{position}].notes must be an array")
        if not notes:
            continue
        previous_end = start
        for note_position, note in enumerate(notes):
            path = f"words[{position}].notes[{note_position}]"
            if not isinstance(note, dict):
                raise ValueError(f"{path} must be an object")
            note_value = note.get("note")
            if isinstance(note_value, bool) or not isinstance(note_value, int):
                raise ValueError(f"{path}.note must be an integer")
            if not 0 <= note_value <= 127:
                raise ValueError(f"{path}.note must be between 0 and 127")
            note_start = _number(note.get("start"), f"{path}.start")
            note_end = _number(note.get("end"), f"{path}.end")
            if note_start < start - _EPSILON or note_end > end + _EPSILON:
                raise ValueError(f"{path} lies outside its word")
            if note_end <= note_start:
                raise ValueError(f"{path}.start must be less than end")
            if note_start < previous_end - _EPSILON:
                raise ValueError(f"{path} overlaps the previous note")
            previous_end = note_end
    return payload


def _acoustic_note_rows(
    word_start: float,
    word_end: float,
    rows: list[tuple[int, float, float]],
) -> list[dict[str, Any]]:
    compact: list[tuple[int, float, float]] = []
    for note, start, end in sorted(rows, key=lambda item: (item[1], item[2], item[0])):
        clipped_start = max(float(word_start), float(start))
        clipped_end = min(float(word_end), float(end))
        if clipped_end <= clipped_start + _EPSILON:
            continue
        if compact and compact[-1][0] == int(note) and clipped_start <= compact[-1][2] + _EPSILON:
            previous = compact[-1]
            compact[-1] = (previous[0], previous[1], max(previous[2], clipped_end))
            continue
        if compact and clipped_start < compact[-1][2]:
            boundary = (clipped_start + compact[-1][2]) / 2.0
            previous = compact[-1]
            compact[-1] = (previous[0], previous[1], boundary)
            clipped_start = boundary
        compact.append((int(note), clipped_start, clipped_end))
    return [
        {"note": note, "start": start, "end": end}
        for note, start, end in compact
        if end > start + _EPSILON
    ]


def _acoustic_word_notes(word: Word, owned: list[VocalNote]) -> list[dict[str, Any]]:
    return _acoustic_note_rows(
        float(word.start),
        float(word.end),
        [(note.midi_note, note.start, note.end) for note in owned],
    )


def words_with_notes(words: list[Word], notes: list[VocalNote]) -> list[dict[str, Any]]:
    result = [{**to_dict(word), "notes": []} for word in words]
    if not result:
        return result

    assigned: list[list[VocalNote]] = [[] for _ in result]
    for note in notes:
        for word_index, word in enumerate(words):
            overlap = min(float(note.end), float(word.end)) - max(
                float(note.start), float(word.start)
            )
            if overlap > _EPSILON:
                assigned[word_index].append(note)

    for word_index, owned in enumerate(assigned):
        payload_word = result[word_index]
        source_word = words[word_index]
        payload_word["notes"] = _acoustic_word_notes(source_word, owned)

    validate_lyrics_document({"bpm": 1, "key": "unknown", "words": result})
    return result


def flatten_word_notes(payload: dict[str, Any]) -> list[dict[str, Any]]:
    validate_lyrics_document(payload)
    return [
        {**note, "word_index": word_index}
        for word_index, word in enumerate(payload["words"])
        for note in word["notes"]
    ]


def replace_word_notes(
    payload: dict[str, Any], raw_notes: list[dict[str, Any]]
) -> dict[str, Any]:
    words = [{**word, "notes": []} for word in payload.get("words", [])]
    if not words:
        raise ValueError("lyricsSync.json has no words")
    for position, raw in enumerate(raw_notes):
        if not isinstance(raw, dict):
            raise ValueError(f"notes[{position}] must be an object")
        index = raw.get("word_index")
        if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < len(words):
            raise ValueError(f"notes[{position}].word_index is invalid")
        note_start = _number(raw.get("start"), f"notes[{position}].start")
        note_end = _number(raw.get("end"), f"notes[{position}].end")
        word_start = _number(words[index].get("start"), f"words[{index}].start")
        word_end = _number(words[index].get("end"), f"words[{index}].end")
        if note_start < word_start - _EPSILON or note_end > word_end + _EPSILON:
            raise ValueError(f"notes[{position}] lies outside its word")
        if note_end <= note_start:
            raise ValueError(f"notes[{position}].start must be less than end")
        words[index]["notes"].append(
            {
                "note": raw.get("note"),
                "start": note_start,
                "end": note_end,
            }
        )
    for word in words:
        notes = word["notes"]
        if not notes:
            continue
        start, end = _number(word["start"], "word.start"), _number(word["end"], "word.end")
        word["notes"] = _acoustic_note_rows(
            start,
            end,
            [
                (
                    int(note["note"]),
                    _number(note["start"], "note.start"),
                    _number(note["end"], "note.end"),
                )
                for note in notes
            ],
        )
    result = {**payload, "words": words}
    return validate_lyrics_document(result)
