from __future__ import annotations

import math
from typing import Any

from .models import VocalNote, Word, to_dict

_EPSILON = 1e-9
_NOTE_NAMES = {"C": 0, "C#": 1, "DB": 1, "D": 2, "D#": 3, "EB": 3, "E": 4, "F": 5, "F#": 6, "GB": 6, "G": 7, "G#": 8, "AB": 8, "A": 9, "A#": 10, "BB": 10, "B": 11}
_SCALE_INTERVALS = {"major": (0, 2, 4, 5, 7, 9, 11), "minor": (0, 2, 3, 5, 7, 8, 10)}


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
            raise ValueError(f"words[{position}].notes must cover the word")
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
            if abs(note_start - previous_end) > _EPSILON:
                raise ValueError(f"{path} leaves a gap in the word")
            previous_end = note_end
        if abs(previous_end - end) > _EPSILON:
            raise ValueError(f"words[{position}].notes do not reach the word end")
    return payload


def _interval_distance(note: VocalNote, word: Word) -> float:
    if note.end < word.start:
        return float(word.start - note.end)
    if note.start > word.end:
        return float(note.start - word.end)
    return 0.0


def _continuous_word_notes(word: Word, owned: list[VocalNote]) -> list[dict[str, Any]]:
    ordered = sorted(owned, key=lambda item: (item.start, item.end, item.midi_note))
    compact: list[VocalNote] = []
    for note in ordered:
        if compact and compact[-1].midi_note == note.midi_note:
            continue
        compact.append(note)
    if not compact:
        return []
    boundaries = [float(word.start)]
    for left, right in zip(compact, compact[1:], strict=False):
        boundaries.append((float(left.end) + float(right.start)) / 2.0)
    boundaries.append(float(word.end))
    if any(right <= left for left, right in zip(boundaries, boundaries[1:], strict=False)):
        step = (float(word.end) - float(word.start)) / len(compact)
        boundaries = [float(word.start) + step * index for index in range(len(compact) + 1)]
    return [
        {"note": int(note.midi_note), "start": boundaries[index], "end": boundaries[index + 1]}
        for index, note in enumerate(compact)
    ]


def words_with_notes(words: list[Word], notes: list[VocalNote]) -> list[dict[str, Any]]:
    result = [{**to_dict(word), "notes": []} for word in words]
    if not result:
        return result

    assigned: list[list[VocalNote]] = [[] for _ in result]
    for note in notes:
        overlaps = [
            max(0.0, min(float(note.end), float(word.end)) - max(float(note.start), float(word.start)))
            for word in words
        ]
        preferred = note.word_index
        if preferred is not None and 0 <= preferred < len(words) and overlaps[preferred] > _EPSILON:
            owner = preferred
        else:
            owner = max(range(len(words)), key=overlaps.__getitem__)
            if overlaps[owner] <= _EPSILON:
                continue
        assigned[owner].append(note)

    for word_index, owned in enumerate(assigned):
        word = result[word_index]
        source_word = words[word_index]
        if not owned and notes:
            owned = [min(notes, key=lambda note: _interval_distance(note, source_word))]
        word["notes"] = _continuous_word_notes(source_word, owned)

    validate_lyrics_document({"bpm": 1, "key": "unknown", "words": result})
    return result


def flatten_word_notes(payload: dict[str, Any]) -> list[dict[str, Any]]:
    validate_lyrics_document(payload)
    return [
        {**note, "word_index": word_index}
        for word_index, word in enumerate(payload["words"])
        for note in word["notes"]
    ]


def stabilize_lyrics_melody(payload: dict[str, Any]) -> dict[str, Any]:
    key_parts = str(payload.get("key") or "").strip().upper().split()
    tonic = _NOTE_NAMES.get(key_parts[0]) if key_parts else None
    mode = key_parts[1].lower() if len(key_parts) > 1 else ""
    intervals = _SCALE_INTERVALS.get(mode)
    if tonic is None or intervals is None:
        return validate_lyrics_document(payload)
    scale = {(tonic + interval) % 12 for interval in intervals}
    entries = [
        (word, note)
        for word in payload["words"]
        for note in word["notes"]
    ]
    pitches = [int(note["note"]) for _word, note in entries]
    repaired = list(pitches)
    for index in range(1, len(repaired) - 1):
        left, current, right = repaired[index - 1], repaired[index], repaired[index + 1]
        if abs(left - right) > 3:
            continue
        target = (left + right) / 2
        duration = float(entries[index][1]["end"]) - float(entries[index][1]["start"])
        if duration <= 0.35 and abs(current - target) >= 5:
            repaired[index] = int(round(target))
            continue
        candidates = [current + shift for shift in (-24, -12, 0, 12, 24)]
        candidate = min((value for value in candidates if 0 <= value <= 127), key=lambda value: abs(value - target))
        if abs(current - target) >= 5 and abs(candidate - target) + 3 <= abs(current - target):
            repaired[index] = candidate
    for index, pitch in enumerate(repaired):
        if pitch % 12 in scale:
            continue
        neighbours = repaired[max(0, index - 1):index] + repaired[index + 1:index + 2]
        target = sum(neighbours) / len(neighbours) if neighbours else pitch
        candidates = [value for value in range(max(0, pitch - 2), min(127, pitch + 2) + 1) if value % 12 in scale]
        if candidates:
            repaired[index] = min(candidates, key=lambda value: (abs(value - pitch), abs(value - target)))
    for (_word, note), pitch in zip(entries, repaired, strict=True):
        note["note"] = pitch
    for word_index, word in enumerate(payload["words"]):
        if float(word["end"]) - float(word["start"]) >= 0.12:
            continue
        neighbours: list[tuple[float, int]] = []
        for direction in (-1, 1):
            index = word_index + direction
            while 0 <= index < len(payload["words"]):
                candidate = payload["words"][index]
                if candidate["notes"] and float(candidate["end"]) - float(candidate["start"]) >= 0.12:
                    distance = (
                        float(word["start"]) - float(candidate["end"])
                        if direction < 0
                        else float(candidate["start"]) - float(word["end"])
                    )
                    pitch = int(candidate["notes"][-1 if direction < 0 else 0]["note"])
                    neighbours.append((max(0.0, distance), pitch))
                    break
                index += direction
        if neighbours and word["notes"]:
            target = min(neighbours, key=lambda item: item[0])[1]
            word["notes"] = [{"note": target, "start": word["start"], "end": word["end"]}]
    for word in payload["words"]:
        compact: list[dict[str, Any]] = []
        for note in word["notes"]:
            if compact and compact[-1]["note"] == note["note"]:
                compact[-1]["end"] = note["end"]
            else:
                compact.append(note)
        word["notes"] = compact
    return validate_lyrics_document(payload)


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
        word["notes"].sort(key=lambda item: (_number(item.get("start"), "note.start"), _number(item.get("end"), "note.end")))
    available = [note for word in words for note in word["notes"]]
    for word in words:
        notes = word["notes"]
        if not notes and available:
            midpoint = (_number(word["start"], "word.start") + _number(word["end"], "word.end")) / 2
            nearest = min(
                available,
                key=lambda note: abs(
                    (_number(note["start"], "note.start") + _number(note["end"], "note.end")) / 2
                    - midpoint
                ),
            )
            notes = [{**nearest}]
        if not notes:
            continue
        compact: list[dict[str, Any]] = []
        for note in notes:
            if compact and compact[-1].get("note") == note.get("note"):
                continue
            compact.append(note)
        start, end = _number(word["start"], "word.start"), _number(word["end"], "word.end")
        boundaries = [start]
        for left, right in zip(compact, compact[1:], strict=False):
            boundaries.append(
                (_number(left["end"], "note.end") + _number(right["start"], "note.start")) / 2
            )
        boundaries.append(end)
        if any(right <= left for left, right in zip(boundaries, boundaries[1:], strict=False)):
            step = (end - start) / len(compact)
            boundaries = [start + step * index for index in range(len(compact) + 1)]
        word["notes"] = [
            {"note": note.get("note"), "start": boundaries[index], "end": boundaries[index + 1]}
            for index, note in enumerate(compact)
        ]
    result = {**payload, "words": words}
    return validate_lyrics_document(result)
