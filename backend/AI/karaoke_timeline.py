from __future__ import annotations

from collections import defaultdict
from typing import Any

from .engines.text import tokenize
from .models import Syllable, VocalNote, Word, to_dict

KARAOKE_TIMELINE_VERSION = "v1-songmap-authoritative-display-notes"


def _dict(item: Any) -> dict[str, Any]:
    return dict(item) if isinstance(item, dict) else dict(to_dict(item))


def _integer(value: Any, default: int | None = None) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _midi(note: dict[str, Any]) -> int | None:
    raw = note.get("midi_note", note.get("midi"))
    try:
        value = int(round(float(raw)))
    except (TypeError, ValueError):
        return None
    return value if 0 <= value <= 127 else None


def _positive_duration(note: dict[str, Any]) -> float:
    try:
        return max(0.0, float(note.get("end", 0.0)) - float(note.get("start", 0.0)))
    except (TypeError, ValueError):
        return 0.0


def _merge_display_notes(notes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Expose acoustic/game events without merging genuine repeated notes."""
    clean = [
        dict(note) for note in notes if _midi(note) is not None and _positive_duration(note) > 0.0
    ]
    for note in clean:
        note["midi_note"] = _midi(note)
        note["display_source"] = "acoustic_game_note"
    clean.sort(key=lambda item: (float(item["start"]), float(item["end"]), int(item["midi_note"])))
    return clean


def _syllable_indices(note: dict[str, Any]) -> tuple[int, ...]:
    raw = note.get("syllable_indices")
    values = raw if isinstance(raw, (list, tuple, set)) else (note.get("syllable_index"),)
    return tuple(dict.fromkeys(index for value in values if (index := _integer(value)) is not None))


def build_karaoke_song_map(
    *,
    lyrics_text: str,
    words: list[Word],
    syllables: list[Syllable],
    game_notes: list[VocalNote],
    duration: float,
    bpm: float,
    key: str | None,
    ai_build_id: str,
    note_decoder_version: str,
) -> dict[str, Any]:
    word_payload = [_dict(item) for item in words]
    syllable_payload = [_dict(item) for item in syllables]
    note_payload = [_dict(item) for item in game_notes]
    display_notes = _merge_display_notes(note_payload)

    syllables_by_word: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for item in syllable_payload:
        word_index = _integer(item.get("word_index"))
        if word_index is None:
            continue
        syllables_by_word[word_index].append(item)
    display_by_syllable: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for item in display_notes:
        for syllable_index in _syllable_indices(item):
            display_by_syllable[syllable_index].append(item)

    for values in syllables_by_word.values():
        values.sort(
            key=lambda item: (float(item.get("start", 0.0)), _integer(item.get("index"), 0))
        )
    for values in display_by_syllable.values():
        values.sort(key=lambda item: (float(item.get("start", 0.0)), float(item.get("end", 0.0))))

    prepared_words: list[dict[str, Any]] = []
    for index, source in enumerate(word_payload):
        word = dict(source)
        word_index = _integer(word.get("index"), index)
        linked_syllables: list[dict[str, Any]] = []
        for source_syllable in syllables_by_word.get(word_index, []):
            syllable = dict(source_syllable)
            syllable_index = _integer(syllable.get("index"), -1)
            linked_notes = [dict(note) for note in display_by_syllable.get(syllable_index, [])]
            syllable["timing_source"] = "syllable_alignment"
            syllable["display_notes"] = linked_notes
            linked_syllables.append(syllable)
        word["timing_source"] = "word_alignment"
        word["syllables"] = linked_syllables
        prepared_words.append(word)

    line_texts = [line.strip() for line in str(lyrics_text or "").splitlines() if tokenize(line)]
    line_counts = [len(tokenize(line)) for line in line_texts]
    lines: list[dict[str, Any]] = []
    cursor = 0
    for line_index, (line_text, count) in enumerate(zip(line_texts, line_counts, strict=True)):
        is_last_line = line_index == len(line_texts) - 1
        line_words = (
            prepared_words[cursor:] if is_last_line else prepared_words[cursor : cursor + count]
        )
        cursor += count
        if not line_words:
            continue
        lines.append(
            {
                "index": line_index,
                "text": line_text,
                "start": min(float(word.get("start", 0.0)) for word in line_words),
                "end": max(float(word.get("end", 0.0)) for word in line_words),
                "words": line_words,
            }
        )

    return {
        "version": KARAOKE_TIMELINE_VERSION,
        "duration": float(duration),
        "bpm": float(bpm),
        "key": key,
        "ai_build_id": ai_build_id,
        "note_decoder_version": note_decoder_version,
        "words": word_payload,
        "syllables": syllable_payload,
        "notes": note_payload,
        "display_notes": display_notes,
        "lines": lines,
        "display_stats": {
            "game_note_count": len(note_payload),
            "display_note_count": len(display_notes),
            "syllable_count": len(syllable_payload),
        },
    }
