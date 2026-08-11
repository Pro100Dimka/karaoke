from __future__ import annotations

import json
from pathlib import Path

from app.services import ai_bridge


def write(path: Path, payload):
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def test_karaoke_payload_keeps_canonical_word_times_and_game_note_links(tmp_path):
    write(
        tmp_path / "lyricsSync.json",
        {
            "text": "Один два\nТри",
            "words": [
                {"index": 0, "text": "Один", "start": 1.11, "end": 1.44, "confidence": 0.9},
                {"index": 1, "text": "два", "start": 1.73, "end": 2.02, "confidence": 0.8},
                {"index": 2, "text": "Три", "start": 3.25, "end": 3.61, "confidence": 0.7},
            ],
        },
    )
    write(
        tmp_path / "syllables.json",
        {"syllables": [{"index": 0, "word_index": 0, "text": "О", "start": 1.11, "end": 1.2}]},
    )
    write(
        tmp_path / "reference.json",
        {"notes": [{"start": 1.08, "end": 1.2, "midi_note": 60, "word_index": 0, "syllable_index": 0}]},
    )

    lines = ai_bridge.get_karaoke_lyrics(tmp_path)
    flat = [word for line in lines for word in line["words"]]
    assert [(word["start"], word["end"]) for word in flat] == [
        (1.11, 1.44),
        (1.73, 2.02),
        (3.25, 3.61),
    ]
    assert [word["index"] for word in flat] == [0, 1, 2]

    notes = ai_bridge.get_game_notes(tmp_path)
    assert notes[0]["midi"] == 60
    assert notes[0]["word_index"] == 0
    assert notes[0]["syllable_index"] == 0
    assert ai_bridge.get_syllables(tmp_path)[0]["word_index"] == 0


def test_game_notes_do_not_fall_back_to_acoustic_cache(tmp_path):
    cache = tmp_path / ".ai-cache"
    cache.mkdir()
    write(cache / "vocal-notes.json", {"notes": [{"start": 1, "end": 2, "midi_note": 48}]})
    write(tmp_path / "reference.json", {"notes": [{"start": 1.2, "end": 1.5, "midi_note": 60, "syllable_index": 4}]})

    assert ai_bridge.get_reference_notes(tmp_path)[0]["midi"] == 48
    assert ai_bridge.get_game_notes(tmp_path)[0]["midi"] == 60
    assert ai_bridge.get_game_notes(tmp_path)[0]["syllable_index"] == 4


def test_karaoke_timeline_is_backend_authoritative_and_note_driven(tmp_path):
    write(
        tmp_path / "lyricsSync.json",
        {
            "text": "мама",
            "words": [
                {"index": 0, "text": "мама", "start": 1.00, "end": 1.80, "confidence": 0.9},
            ],
        },
    )
    write(
        tmp_path / "syllables.json",
        {
            "syllables": [
                {"index": 0, "word_index": 0, "text": "ма", "start": 1.00, "end": 1.35},
                {"index": 1, "word_index": 0, "text": "ма", "start": 1.35, "end": 1.80},
            ]
        },
    )
    write(
        tmp_path / "reference.json",
        {
            "notes": [
                {"start": 0.96, "end": 1.31, "midi_note": 60, "word_index": 0, "syllable_index": 0},
                {"start": 1.31, "end": 1.52, "midi_note": 60, "word_index": 0, "syllable_index": 1},
                {"start": 1.52, "end": 1.86, "midi_note": 62, "word_index": 0, "syllable_index": 1},
            ]
        },
    )
    write(tmp_path / "songMap.json", {"duration": 10.0})

    timeline = ai_bridge.get_karaoke_timeline(tmp_path)
    assert timeline["version"] == 1
    assert timeline["clock"] == "instrumental_seconds"
    assert timeline["duration"] == 10.0
    assert len(timeline["lines"]) == 1

    word = timeline["lines"][0]["words"][0]
    assert word["timing_source"] == "syllables_game_notes"
    assert (word["start"], word["end"]) == (0.96, 1.86)
    assert len(word["syllables"]) == 2

    first, second = word["syllables"]
    assert (first["start"], first["end"]) == (0.96, 1.31)
    assert first["timing_source"] == "game_notes"
    assert [note["midi"] for note in first["notes"]] == [60]
    assert (second["start"], second["end"]) == (1.31, 1.86)
    assert [note["midi"] for note in second["notes"]] == [60, 62]


def test_karaoke_timeline_falls_back_to_alignment_when_syllable_has_no_note(tmp_path):
    write(
        tmp_path / "lyricsSync.json",
        {"text": "я", "words": [{"index": 0, "text": "я", "start": 2.0, "end": 2.4}]},
    )
    write(
        tmp_path / "syllables.json",
        {"syllables": [{"index": 0, "word_index": 0, "text": "я", "start": 2.05, "end": 2.35}]},
    )
    write(tmp_path / "reference.json", {"notes": []})
    write(tmp_path / "songMap.json", {"duration": 5.0})

    timeline = ai_bridge.get_karaoke_timeline(tmp_path)
    syllable = timeline["lines"][0]["words"][0]["syllables"][0]
    assert syllable["timing_source"] == "syllable_alignment"
    assert (syllable["start"], syllable["end"]) == (2.05, 2.35)
