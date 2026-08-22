from __future__ import annotations

from typing import Any

from .models import VocalNote, Word, to_dict

LYRICS_TIME_DIGITS = 3


def validate_lyrics_document(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict) or any(key not in payload for key in ("bpm", "key", "words")) or not isinstance(payload["words"], list):
        raise ValueError("lyricsSync.json must contain bpm, key and words")
    previous = 0.0
    for index, word in enumerate(payload["words"]):
        if not isinstance(word, dict) or not str(word.get("text", "")).strip():
            raise ValueError(f"Invalid word {index}")
        start, end = float(word.get("start", -1)), float(word.get("end", -1))
        if start < 0 or end <= start or start + 1e-6 < previous:
            raise ValueError(f"Invalid word interval {index}")
        previous = start
        previous_note_end = -1.0
        for note in word.setdefault("notes", []):
            note_start, note_end = float(note.get("start", -1)), float(note.get("end", -1))
            midi = int(note.get("note", -1))
            if note_end <= note_start or note_end <= start or note_start >= end or not 0 <= midi <= 127:
                print(
                    f"[lyrics_document] word {index} {word.get('text')!r} "
                    f"[{start!r}..{end!r}] rejects note {note!r}; "
                    f"full word.notes={word.get('notes')!r}",
                    flush=True,
                )
                raise ValueError(f"Invalid note interval in word {index}")
            if note_start < previous_note_end - 1e-6:
                raise ValueError(f"Overlapping notes in word {index}")
            previous_note_end = note_end
    return payload


def words_with_notes(words: list[Word], notes: list[VocalNote]) -> list[dict[str, Any]]:
    result = []
    for word in words:
        owned = [note for note in notes if note.end > word.start and note.start < word.end]
        clipped = []
        for note in owned:
            start, end = max(note.start, word.start), min(note.end, word.end)
            if round(end, LYRICS_TIME_DIGITS) <= round(start, LYRICS_TIME_DIGITS):
                print(
                    f"[notes] dropping degenerate clip: word#{word.index} "
                    f"[{word.start:.6f}..{word.end:.6f}] note(word_index={note.word_index}) "
                    f"[{note.start:.6f}..{note.end:.6f}] -> clipped [{start:.6f}..{end:.6f}]",
                    flush=True,
                )
                continue
            clipped.append({"note": note.midi_note, "start": start, "end": end})
        result.append({**to_dict(word), "notes": clipped})
    return result


def flatten_word_notes(payload: dict[str, Any]) -> list[dict[str, Any]]:
    unique = {}
    for index, word in enumerate(payload.get("words", [])):
        for note in word.get("notes", []):
            unique[(note.get("note"), note.get("start"), note.get("end"))] = {**note, "word_index": index}
    return list(unique.values())


def replace_word_notes(payload: dict[str, Any], notes_by_word: list[dict]) -> dict[str, Any]:
    words = [dict(word) for word in payload.get("words", [])]
    for word in words:
        word["notes"] = []
    for note in notes_by_word:
        index = int(note.get("word_index", -1))
        if not 0 <= index < len(words):
            raise ValueError("Invalid word index")
        start, end = float(note.get("start", -1)), float(note.get("end", -1))
        if start < float(words[index]["start"]) or end > float(words[index]["end"]) or end <= start:
            raise ValueError("Manual note must stay inside its word")
        words[index]["notes"].append({key: note[key] for key in ("note", "start", "end")})
    return validate_lyrics_document({**payload, "words": words})
